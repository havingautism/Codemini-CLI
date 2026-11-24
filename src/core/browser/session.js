import { performance } from 'node:perf_hooks';
import { findInstalledBrowsers } from './locate-browser.js';
import { resolveBrowserConfig } from './schema.js';
import { sourceResolverFor } from './diagnostics.js';

let playwrightModule = null;
let playwrightImportMs = 0;

export function playwrightCoreLoaded() {
  return playwrightModule != null;
}

export function playwrightImportDuration() {
  return playwrightImportMs;
}

async function loadPlaywright() {
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

function launchPlans(config, override) {
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
    plans.push({ headless, args, ...(plan.channel ? { channel: plan.channel } : {}), ...(plan.executablePath ? { executablePath: plan.executablePath } : {}) });
  };
  const addBinary = (plan) => {
    push(plan);
    if (!forcedSandboxOff) push({ ...plan, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  };

  if (executable) {
    addBinary({ executablePath: executable });
    return { plans, label: 'executable', explicitExecutable: true };
  }

  const installed = findInstalledBrowsers();
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

function sameLaunch(left, right) {
  if (!left || !right) return false;
  return left.headless === right.headless
    && left.viewport_width === right.viewport_width
    && left.viewport_height === right.viewport_height
    && left.channel === right.channel
    && left.executable_path === right.executable_path;
}

export function createBrowserSession({ config = {}, workspaceRoot = process.cwd() } = {}) {
  const session = {
    config,
    workspaceRoot,
    browser: null,
    context: null,
    page: null,
    cdp: null,
    refs: new Map(),
    refKeys: new Map(),
    roleCounts: new Map(),
    nextRef: 1,
    scripts: new Map(),
    logs: [],
    nextLogId: 1,
    logCursor: 0,
    lastSnapshotText: '',
    launch: null,
    importMs: 0,
    launchMs: 0,
    lastChannel: '',
  };

  function pushLog(entry) {
    session.logs.push({ id: session.nextLogId, ...entry });
    session.nextLogId += 1;
    if (session.logs.length > 200) {
      session.logs.splice(0, session.logs.length - 200);
    }
  }

  function attachPage(page) {
    page.on('console', (message) => {
      pushLog({ kind: 'console', level: message.type(), text: message.text().slice(0, 500) });
    });
    page.on('pageerror', (error) => {
      pushLog({
        kind: 'exception',
        level: 'error',
        text: String(error?.message || error).slice(0, 500),
        stack: String(error?.stack || '').slice(0, 500),
      });
    });
    page.on('request', (request) => {
      const type = request.resourceType();
      if (!['document', 'fetch', 'xhr'].includes(type)) return;
      pushLog({
        kind: 'network',
        level: 'info',
        text: `${request.method()} ${request.url()}`.slice(0, 300),
        url: request.url(),
      });
    });
    page.on('response', (response) => {
      if (response.status() < 400) return;
      const type = response.request().resourceType();
      if (!['document', 'fetch', 'xhr'].includes(type)) return;
      pushLog({
        kind: 'network',
        level: 'error',
        text: `${response.status()} ${response.url()}`.slice(0, 300),
        url: response.url(),
      });
    });
    page.on('dialog', (dialog) => {
      dialog.dismiss().catch(() => {});
    });
  }

  async function attachCdp(page) {
    const cdp = await page.context().newCDPSession(page);
    cdp.on('Debugger.scriptParsed', (event) => {
      session.scripts.set(event.scriptId, event);
    });
    await cdp.send('Debugger.enable').catch(() => {});
    await cdp.send('DOM.enable').catch(() => {});
    await cdp.send('CSS.enable').catch(() => {});
    await cdp.send('Runtime.enable').catch(() => {});
    await cdp.send('Page.enable').catch(() => {});
    session.cdp = cdp;
  }

  session.isOpen = () => Boolean(session.page);
  session.sourceResolver = () => sourceResolverFor(session);
  session.scriptByUrl = (url) => {
    const target = String(url || '');
    for (const script of session.scripts.values()) {
      if (script.url === target) return script;
    }
    return null;
  };
  session.readLogs = ({ since = 'last_read', kind = 'all', level = 'all', limit = 40 } = {}) => {
    const start = since === 'session' ? 0 : session.logCursor;
    const entries = session.logs.filter((entry) => {
      if (entry.id < start) return false;
      if (kind !== 'all' && entry.kind !== kind) return false;
      if (level === 'error' && entry.level !== 'error') return false;
      if (level === 'warning' && entry.level !== 'warning' && entry.level !== 'error') return false;
      return true;
    });
    if (since !== 'session') {
      const last = session.logs[session.logs.length - 1];
      session.logCursor = last ? last.id + 1 : session.logCursor;
    }
    return entries.slice(-limit).map(({ id, ...entry }) => entry);
  };

  session.launchBrowser = async (override = {}) => {
    const resolved = resolveBrowserConfig(config);
    const signature = {
      headless: override.headless == null ? resolved.headless : override.headless !== false,
      viewport_width: override.viewport_width || resolved.viewport_width,
      viewport_height: override.viewport_height || resolved.viewport_height,
      channel: String(override.channel || ''),
      executable_path: String(override.executable_path || resolved.executable_path || ''),
    };
    if (session.page) {
      if (!sameLaunch(session.launch, signature)) {
        const error = new Error('Close the browser before changing channel, executable, headless, or viewport.');
        error.code = 'BROWSER_ALREADY_OPEN';
        throw error;
      }
      return { reused: true };
    }
    const { plans, label } = launchPlans(config, override);
    if (!plans.length) {
      const error = new Error('No Chrome, Edge, or Chromium executable was found. Install one or set browser.executable_path.');
      error.code = 'BROWSER_LAUNCH_FAILED';
      throw error;
    }
    const playwright = await loadPlaywright();
    session.importMs = playwrightImportMs;
    let browser = null;
    let used = null;
    let lastError = null;
    const started = performance.now();
    for (const plan of plans) {
      try {
        browser = await playwright.chromium.launch(plan);
        used = plan;
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    session.launchMs = performance.now() - started;
    if (!browser) {
      const error = new Error(lastError instanceof Error ? lastError.message : String(lastError));
      error.code = 'BROWSER_LAUNCH_FAILED';
      throw error;
    }
    const context = await browser.newContext({
      viewport: { width: signature.viewport_width, height: signature.viewport_height },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(resolved.timeout_ms);
    page.setDefaultNavigationTimeout(resolved.timeout_ms);
    attachPage(page);
    session.browser = browser;
    session.context = context;
    session.page = page;
    session.launch = signature;
    session.lastChannel = used.channel || label;
    session.refs.clear();
    session.lastSnapshotText = '';
    await attachCdp(page);
    return { reused: false };
  };

  session.resetCdp = async () => {
    if (!session.page) return;
    try { await session.cdp?.detach(); } catch { /* already detached */ }
    session.scripts.clear();
    await attachCdp(session.page);
  };

  session.dispose = async () => {
    const browser = session.browser;
    session.page = null;
    session.context = null;
    session.browser = null;
    session.cdp = null;
    session.launch = null;
    session.refs.clear();
    session.scripts.clear();
    session.logs = [];
    session.lastSnapshotText = '';
    if (browser) {
      try { await browser.close(); } catch { /* already closed */ }
    }
  };

  return session;
}
