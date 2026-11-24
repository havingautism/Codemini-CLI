import { performance } from 'node:perf_hooks';
import { resolveBrowserConfig } from './schema.js';
import { sourceResolverFor } from './diagnostics.js';
import {
  launchPlaywrightCoreBrowser,
  playwrightCoreLoaded,
  playwrightImportDuration,
} from './launch.js';

export { playwrightCoreLoaded, playwrightImportDuration };

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
        stack: String(error?.stack || '').slice(0, 2000),
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

  session.isOpen = () => Boolean(session.browser?.isConnected() && session.page && !session.page.isClosed());
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
    if (session.isOpen()) {
      if (!sameLaunch(session.launch, signature)) {
        const error = new Error('Close the browser before changing channel, executable, headless, or viewport.');
        error.code = 'BROWSER_ALREADY_OPEN';
        throw error;
      }
      return { reused: true };
    }
    if (session.browser) await session.dispose();
    const started = performance.now();
    const opened = await launchPlaywrightCoreBrowser({ config, override });
    session.importMs = playwrightImportDuration();
    session.launchMs = performance.now() - started;
    if (!opened.browser) {
      const error = new Error('No Chrome, Edge, or Chromium executable was found. Install one or set browser.executable_path.');
      error.code = 'BROWSER_LAUNCH_FAILED';
      throw error;
    }
    session.browser = opened.browser;
    try {
      session.context = await session.browser.newContext({
        viewport: { width: signature.viewport_width, height: signature.viewport_height },
      });
      const page = await session.context.newPage();
      page.setDefaultTimeout(resolved.timeout_ms);
      page.setDefaultNavigationTimeout(resolved.timeout_ms);
      attachPage(page);
      await attachCdp(page);
      session.page = page;
      session.launch = signature;
      session.lastChannel = opened.plan.channel || opened.label;
      return { reused: false };
    } catch (error) {
      await session.dispose();
      throw error;
    }
  };

  session.resetCdp = async () => {
    if (!session.isOpen()) return;
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
    session.refKeys.clear();
    session.roleCounts.clear();
    session.nextRef = 1;
    session.scripts.clear();
    session.logs = [];
    session.lastSnapshotText = '';
    if (browser) {
      try { await browser.close(); } catch { /* already closed */ }
    }
  };

  return session;
}
