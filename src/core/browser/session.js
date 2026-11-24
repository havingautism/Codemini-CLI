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

export function isUsableBrowserPage(session) {
  const page = session?.page;
  const browser = session?.browser;
  if (!page) return false;
  try {
    if (typeof page.isClosed === 'function' && page.isClosed()) return false;
    if (!browser || (typeof browser.isConnected === 'function' && browser.isConnected() === false)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function headedWindowBounds(screen = {}, preferred = {}) {
  const margin = 16;
  const availWidth = Math.max(0, Number(screen.availWidth) || 0);
  const availHeight = Math.max(0, Number(screen.availHeight) || 0);
  const availLeft = Number.isFinite(Number(screen.availLeft)) ? Number(screen.availLeft) : 0;
  const availTop = Number.isFinite(Number(screen.availTop)) ? Number(screen.availTop) : 0;
  const preferredWidth = Number(preferred.width) > 0 ? Number(preferred.width) : 1280;
  const preferredHeight = Number(preferred.height) > 0 ? Number(preferred.height) : 800;
  const width = availWidth > 0
    ? Math.min(preferredWidth, Math.max(Math.min(availWidth, 320), availWidth - margin))
    : preferredWidth;
  const height = availHeight > 0
    ? Math.min(preferredHeight, Math.max(Math.min(availHeight, 240), availHeight - margin))
    : preferredHeight;
  const left = availLeft + Math.max(0, Math.min(8, Math.max(0, availWidth - width)));
  const top = availTop + Math.max(0, Math.min(8, Math.max(0, availHeight - height)));
  return {
    width: Math.round(width),
    height: Math.round(height),
    left: Math.round(left),
    top: Math.round(top),
    windowState: 'normal',
  };
}

async function fitHeadedWindow(page, preferred) {
  if (!page || (typeof page.isClosed === 'function' && page.isClosed())) return null;
  let screen;
  try {
    screen = await page.evaluate(() => ({
      availWidth: window.screen.availWidth,
      availHeight: window.screen.availHeight,
      availLeft: window.screen.availLeft || 0,
      availTop: window.screen.availTop || 0,
    }));
  } catch {
    return null;
  }
  const bounds = headedWindowBounds(screen, preferred);
  let cdp;
  try {
    cdp = await page.context().newCDPSession(page);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds });
    return bounds;
  } catch {
    return bounds;
  } finally {
    try { await cdp?.detach(); } catch { /* already detached */ }
  }
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

  session.isOpen = () => isUsableBrowserPage(session);

  function clearClosedBrowser() {
    session.page = null;
    session.context = null;
    session.browser = null;
    session.cdp = null;
    session.launch = null;
    session.refs.clear();
    session.scripts.clear();
    session.lastSnapshotText = '';
    if (session.visualFeedback) {
      session.visualFeedback.bindingInstalled = false;
      session.visualFeedback.active = false;
    }
  }

  let browserShutdown = Promise.resolve();

  function requestBrowserClose(browser) {
    if (!browser) return browserShutdown;
    // Leave the page-close stack before browser.close(). Closing inline can deadlock
    // with the Playwright call that emitted this event, and dropping the reference
    // without close() leaves Chrome alive so the test process never exits.
    browserShutdown = browserShutdown.then(() => new Promise((resolve) => {
      setImmediate(() => {
        browser.close().then(resolve, resolve);
      });
    }));
    return browserShutdown;
  }

  function watchBrowserClose(browser, context, page) {
    let handled = false;
    const onClosed = (source) => {
      if (handled) return;
      if (session.page !== page && session.browser !== browser && session.context !== context) return;
      handled = true;
      clearClosedBrowser();
      if (source === 'disconnected') return;
      requestBrowserClose(browser);
    };
    page.on('close', () => onClosed('page'));
    context.on('close', () => onClosed('context'));
    browser.on('disconnected', () => onClosed('disconnected'));
  }
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
    await browserShutdown;
    const resolved = resolveBrowserConfig(config);
    const signature = {
      headless: override.headless == null ? resolved.headless : override.headless !== false,
      viewport_width: override.viewport_width || resolved.viewport_width,
      viewport_height: override.viewport_height || resolved.viewport_height,
      channel: String(override.channel || ''),
      executable_path: String(override.executable_path || resolved.executable_path || ''),
    };
    if (session.page && !isUsableBrowserPage(session)) {
      await session.dispose();
    }
    if (isUsableBrowserPage(session)) {
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
    const browser = opened.browser;
    const used = opened.plan;
    const label = opened.label;
    const headed = signature.headless !== true;
    session.browser = browser;
    try {
      const context = await browser.newContext({
        viewport: headed
          ? null
          : { width: signature.viewport_width, height: signature.viewport_height },
      });
      const page = await context.newPage();
      page.setDefaultTimeout(resolved.timeout_ms);
      page.setDefaultNavigationTimeout(resolved.timeout_ms);
      attachPage(page);
      session.context = context;
      session.page = page;
      session.launch = signature;
      session.lastChannel = used.channel || label;
      session.refs.clear();
      session.lastSnapshotText = '';
      if (session.visualFeedback) {
        session.visualFeedback.bindingInstalled = false;
      }
      watchBrowserClose(browser, context, page);
      await attachCdp(page);
      if (headed) {
        session.windowBounds = await fitHeadedWindow(page, {
          width: signature.viewport_width,
          height: signature.viewport_height,
        });
      }
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
    if (session.visualFeedback) {
      session.visualFeedback.bindingInstalled = false;
      session.visualFeedback.active = false;
      session.visualFeedback.lastState = null;
    }
    await requestBrowserClose(browser);
  };

  return session;
}

const sharedSessions = new Map();

export function sharedBrowserSessionKey({ sessionId } = {}) {
  const id = String(sessionId || '').trim();
  return id ? `session:${id}` : '';
}

export function getSharedBrowserSession({ config = {}, workspaceRoot = process.cwd(), sessionId } = {}) {
  const key = sharedBrowserSessionKey({ sessionId });
  if (!key) return createBrowserSession({ config, workspaceRoot });
  let session = sharedSessions.get(key);
  if (!session) {
    session = createBrowserSession({ config, workspaceRoot });
    session.sharedKey = key;
    sharedSessions.set(key, session);
  }
  return session;
}

export async function disposeSharedBrowserSession({ sessionId } = {}) {
  const key = sharedBrowserSessionKey({ sessionId });
  if (!key) return false;
  const session = sharedSessions.get(key);
  if (!session) return false;
  sharedSessions.delete(key);
  await session.dispose();
  return true;
}
