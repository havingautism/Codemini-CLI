import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { findInstalledBrowsers } from './locate-browser.js';
import { launchPlaywrightCoreBrowser } from './launch.js';
import { resolveBrowserConfig } from './schema.js';

export const WEB_FETCH_BROWSER_HINT = 'Install Chrome or Edge, or set browser.executable_path, to render JavaScript pages.';

function isMissingPlaywrightError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return (
    code === 'ERR_MODULE_NOT_FOUND'
    || code === 'MODULE_NOT_FOUND'
    || /Cannot find package 'playwright'|Cannot find module 'playwright'/i.test(message)
  );
}

function unwrapPlaywrightModule(mod) {
  if (mod && typeof mod.chromium?.launch === 'function') return mod;
  if (mod?.default && typeof mod.default.chromium?.launch === 'function') return mod.default;
  return null;
}

function readNpmGlobalNodeModules() {
  try {
    const root = execFileSync('npm', ['root', '-g'], {
      encoding: 'utf8',
      timeout: 2500,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return root || '';
  } catch {
    return '';
  }
}

function playwrightGlobalNodeModulesCandidates() {
  const extra = String(process.env.CODEMINI_NPM_GLOBAL_NODE_MODULES || '').trim();
  if (extra) return [extra];
  const roots = [];
  const add = (value) => {
    const root = String(value || '').trim();
    if (!root || roots.includes(root)) return;
    roots.push(root);
  };
  const execDir = path.dirname(process.execPath);
  add(path.resolve(execDir, '..', 'lib', 'node_modules'));
  add(path.resolve(execDir, 'node_modules'));
  add(readNpmGlobalNodeModules());
  return roots;
}

function loadPlaywrightFromNodeModules(nodeModulesDir) {
  const root = String(nodeModulesDir || '').trim();
  if (!root) return null;
  try {
    const requireFromRoot = createRequire(path.join(root, 'package.json'));
    return unwrapPlaywrightModule(requireFromRoot('playwright'));
  } catch (error) {
    if (isMissingPlaywrightError(error)) return null;
    throw error;
  }
}

export async function loadLegacyPlaywright() {
  try {
    const imported = unwrapPlaywrightModule(await import('playwright'));
    if (imported) return imported;
  } catch (error) {
    if (!isMissingPlaywrightError(error)) throw error;
  }
  for (const root of playwrightGlobalNodeModulesCandidates()) {
    const loaded = loadPlaywrightFromNodeModules(root);
    if (loaded) return loaded;
  }
  return null;
}

function buildPlaywrightLaunchEnv() {
  const localLibDir = path.join(
    process.env.HOME || '',
    '.cache',
    'codemini',
    'playwright-libs',
    'usr',
    'lib',
    'x86_64-linux-gnu',
  );
  if (!existsSync(localLibDir)) return process.env;
  const existing = String(process.env.LD_LIBRARY_PATH || '').trim();
  return {
    ...process.env,
    LD_LIBRARY_PATH: existing ? `${localLibDir}:${existing}` : localLibDir,
  };
}

function legacyChromiumPath(playwright) {
  try {
    return String(playwright?.chromium?.executablePath?.() || '').trim();
  } catch {
    return '';
  }
}

function coreStatus(browser, executablePath, browserName = browser) {
  return {
    engine: 'playwright-core',
    browser,
    browserName,
    ready: true,
    packageInstalled: true,
    chromiumReady: true,
    executablePath,
    hint: '',
  };
}

export async function detectPlaywrightStatus({ config = {}, findBrowsers, loadLegacy } = {}) {
  const resolved = resolveBrowserConfig(config);
  const explicit = resolved.executable_path;
  if (explicit) {
    if (existsSync(explicit)) return coreStatus('executable', explicit, 'executable');
    return {
      engine: 'none',
      browser: 'executable',
      browserName: '',
      ready: false,
      packageInstalled: false,
      chromiumReady: false,
      executablePath: explicit,
      hint: WEB_FETCH_BROWSER_HINT,
    };
  }
  const installed = (findBrowsers || findInstalledBrowsers)() || [];
  const wanted = resolved.channel;
  const pick = wanted === 'chrome' || wanted === 'msedge' || wanted === 'chromium'
    ? installed.find((item) => item.channel === wanted)
    : installed.find((item) => item.channel === 'chrome')
      || installed.find((item) => item.channel === 'msedge')
      || installed.find((item) => item.channel === 'chromium')
      || installed[0];
  if (pick) return coreStatus(pick.channel, pick.path, pick.name || pick.channel);

  const legacy = await (loadLegacy || loadLegacyPlaywright)();
  const executablePath = legacyChromiumPath(legacy);
  const chromiumReady = Boolean(legacy) && Boolean(executablePath) && existsSync(executablePath);
  return {
    engine: chromiumReady ? 'playwright' : 'none',
    browser: legacy ? 'chromium' : '',
    browserName: chromiumReady ? 'Chromium' : '',
    ready: chromiumReady,
    packageInstalled: Boolean(legacy),
    chromiumReady,
    executablePath,
    hint: chromiumReady ? '' : WEB_FETCH_BROWSER_HINT,
  };
}

export async function openWebFetchBrowser(config = {}, hooks = {}) {
  const env = buildPlaywrightLaunchEnv();
  let coreError = null;
  try {
    const opened = await launchPlaywrightCoreBrowser({
      config,
      override: { headless: true },
      env,
      findBrowsers: hooks.findBrowsers,
    });
    if (opened.browser) {
      return {
        browser: opened.browser,
        engine: 'playwright-core',
        browserName: opened.label,
      };
    }
  } catch (error) {
    coreError = error;
  }
  if (hooks.loadLegacy === null) {
    if (coreError) throw coreError;
    return null;
  }
  const legacy = await (hooks.loadLegacy || loadLegacyPlaywright)();
  const executablePath = legacyChromiumPath(legacy);
  if (legacy && executablePath && existsSync(executablePath)) {
    const browser = await legacy.chromium.launch({ headless: true, env });
    return { browser, engine: 'playwright', browserName: 'chromium' };
  }
  if (coreError) throw coreError;
  return null;
}
