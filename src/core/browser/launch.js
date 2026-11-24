import { performance } from 'node:perf_hooks';
import { findInstalledBrowsers } from './locate-browser.js';
import { resolveBrowserConfig } from './schema.js';

let playwrightModule = null;
let playwrightImportMs = 0;

export function playwrightCoreLoaded() {
  return playwrightModule != null;
}

export function playwrightImportDuration() {
  return playwrightImportMs;
}

export async function loadPlaywrightCore() {
  if (!playwrightModule) {
    const started = performance.now();
    playwrightModule = await import('playwright-core');
    playwrightImportMs = performance.now() - started;
  }
  return playwrightModule;
}

function withSandbox(args, extra = []) {
  const next = [...args];
  for (const arg of extra) {
    if (!next.includes(arg)) next.push(arg);
  }
  return next;
}

export function browserLaunchPlans(config, override = {}, findBrowsers = findInstalledBrowsers) {
  const resolved = resolveBrowserConfig(config);
  const executable = String(override.executable_path || resolved.executable_path || '').trim();
  const requested = String(override.channel || (executable ? '' : resolved.channel) || '').trim();
  const headless = override.headless == null ? resolved.headless : override.headless !== false;
  const forcedSandboxOff = process.env.CI === 'true' || process.env.CODEMINI_BROWSER_NO_SANDBOX === '1';
  const baseArgs = forcedSandboxOff ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
  const plans = [];
  const seen = new Set();
  const push = (plan) => {
    const args = withSandbox(baseArgs, plan.args || []);
    const key = JSON.stringify({ channel: plan.channel || '', executablePath: plan.executablePath || '', args, headless });
    if (seen.has(key)) return;
    seen.add(key);
    plans.push({
      headless,
      args,
      ...(plan.channel ? { channel: plan.channel } : {}),
      ...(plan.executablePath ? { executablePath: plan.executablePath } : {}),
    });
  };
  const addBinary = (plan) => {
    push(plan);
    if (!forcedSandboxOff) push({ ...plan, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  };

  if (executable) {
    addBinary({ executablePath: executable });
    return { plans, label: 'executable', explicitExecutable: true };
  }

  const installed = findBrowsers() || [];
  if (requested === 'chromium') {
    const found = installed.find((item) => item.channel === 'chromium');
    if (found) addBinary({ executablePath: found.path });
    return { plans, label: 'chromium', explicitExecutable: false };
  }
  if (requested === 'chrome' || requested === 'msedge') {
    addBinary({ channel: requested });
    const found = installed.find((item) => item.channel === requested);
    if (found) addBinary({ executablePath: found.path });
    return { plans, label: requested, explicitExecutable: false };
  }
  const pick = installed.find((item) => item.channel === 'chrome')
    || installed.find((item) => item.channel === 'msedge')
    || installed[0];
  if (!pick) return { plans, label: 'auto', explicitExecutable: false };
  if (pick.channel === 'chrome' || pick.channel === 'msedge') addBinary({ channel: pick.channel });
  addBinary({ executablePath: pick.path });
  return { plans, label: pick.channel, explicitExecutable: false };
}

export async function launchPlaywrightCoreBrowser({
  config = {},
  override = {},
  env,
  findBrowsers,
} = {}) {
  const planned = browserLaunchPlans(config, override, findBrowsers);
  if (!planned.plans.length) return { ...planned, browser: null, plan: null, engine: 'playwright-core' };
  const playwright = await loadPlaywrightCore();
  let lastError = null;
  for (const plan of planned.plans) {
    try {
      const browser = await playwright.chromium.launch(env ? { ...plan, env } : plan);
      return { ...planned, browser, plan, engine: 'playwright-core' };
    } catch (error) {
      lastError = error;
    }
  }
  const error = lastError instanceof Error ? lastError : new Error(String(lastError || 'browser launch failed'));
  error.code = 'BROWSER_LAUNCH_FAILED';
  throw error;
}
