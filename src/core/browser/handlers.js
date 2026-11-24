import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateBrowserAction } from './actions.js';
import { BROWSER_LIMITS, BROWSER_TOOL_NAMES, INTERACTION_STYLE_PROPS, resolveBrowserConfig } from './schema.js';
import { browserError, browserOk, formatBrowserResult } from './result.js';
import { describeTarget, resolveLocator, resolvePageUrl, targetError, validateTarget } from './target.js';
import { runPerformanceProfile } from './performance/run.js';
import { diffSnapshot } from './cascade.js';
import { captureSnapshot } from './snapshot.js';
import { backendForSelector, explainStyle, hitTest, listListeners, locateSource, probeClick } from './diagnostics.js';

function fail(tool, error) {
  const code = error?.code && typeof error.code === 'string' ? error.code : 'BROWSER_ERROR';
  return browserError(tool, code, error instanceof Error ? error.message : String(error));
}

async function guard(tool, fn) {
  try {
    return await fn();
  } catch (error) {
    return fail(tool, error);
  }
}

function requirePage(session, tool) {
  if (!session.page || !session.cdp) {
    return browserError(tool, 'BROWSER_NOT_OPEN', 'Call browser_act with action "open" before using this tool.');
  }
  return null;
}

function pickInt(value, fallback, bounds) {
  if (value == null) return { value: fallback };
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < bounds.min || parsed > bounds.max) {
    return { error: `Expected an integer from ${bounds.min} to ${bounds.max}.` };
  }
  return { value: parsed };
}

function clip(text, max) {
  const value = String(text || '');
  if (value.length <= max) return { text: value, truncated: false };
  return { text: `${value.slice(0, max)}\n[truncated]`, truncated: true };
}

function forgetPageState(session) {
  session.refs.clear();
  session.refKeys.clear();
  session.roleCounts = new Map();
  session.nextRef = 1;
  session.lastSnapshotText = '';
}

async function gotoUrl(session, url, { waitUntil, timeout }) {
  const response = await session.page.goto(url, { waitUntil, timeout });
  forgetPageState(session);
  await session.resetCdp();
  return response;
}

async function open(session, args = {}) {
  return guard('browser_open', async () => {
    const resolvedUrl = resolvePageUrl(session.workspaceRoot, args.url);
    if (resolvedUrl.error) return browserError('browser_open', 'UNSUPPORTED_URL', resolvedUrl.error);
    const width = pickInt(args.viewport_width, resolveBrowserConfig(session.config).viewport_width, BROWSER_LIMITS.viewportWidth);
    const height = pickInt(args.viewport_height, resolveBrowserConfig(session.config).viewport_height, BROWSER_LIMITS.viewportHeight);
    const timeout = pickInt(args.timeout_ms, resolveBrowserConfig(session.config).timeout_ms, BROWSER_LIMITS.timeoutMs);
    if (width.error || height.error || timeout.error) {
      return browserError('browser_open', 'INVALID_ARGUMENTS', width.error || height.error || timeout.error);
    }
    try {
      const launched = await session.launchBrowser({
        url: resolvedUrl.url,
        channel: args.channel,
        executable_path: args.executable_path,
        headless: args.headless,
        viewport_width: width.value,
        viewport_height: height.value,
      });
      if (resolvedUrl.url !== 'about:blank') {
        await gotoUrl(session, resolvedUrl.url, { waitUntil: 'domcontentloaded', timeout: timeout.value });
      }
      const title = await session.page.title();
      const url = session.page.url();
      const summary = `${launched.reused ? 'Reused' : 'Opened'} ${session.lastChannel || 'browser'} ${session.launch?.headless ? 'headless' : 'headed'} at ${url}${title ? ` (${title})` : ''}.`;
      return browserOk('browser_open', {
        summary,
        url,
        title,
        channel: session.lastChannel,
        headless: session.launch?.headless === true,
        viewport: { width: width.value, height: height.value },
        reused: launched.reused === true,
        import_ms: Math.round(session.importMs || 0),
        launch_ms: Math.round(session.launchMs || 0),
      });
    } catch (error) {
      return fail('browser_open', error);
    }
  });
}

async function navigate(session, args = {}) {
  return guard('browser_navigate', async () => {
    const resolvedUrl = resolvePageUrl(session.workspaceRoot, args.url);
    if (resolvedUrl.error) return browserError('browser_navigate', 'UNSUPPORTED_URL', resolvedUrl.error);
    const closed = requirePage(session, 'browser_navigate');
    if (closed) return closed;
    const timeout = pickInt(args.timeout_ms, resolveBrowserConfig(session.config).timeout_ms, BROWSER_LIMITS.timeoutMs);
    if (timeout.error) return browserError('browser_navigate', 'INVALID_ARGUMENTS', timeout.error);
    const waitUntil = args.wait_until || 'domcontentloaded';
    try {
      const response = await gotoUrl(session, resolvedUrl.url, { waitUntil, timeout: timeout.value });
      const title = await session.page.title();
      const status = response ? response.status() : null;
      return browserOk('browser_navigate', {
        summary: `Navigated to ${session.page.url()} (${status ?? 'no status'}, ${waitUntil}). Title: ${title || '(empty)'}.`,
        url: session.page.url(),
        title,
        status,
        wait_until: waitUntil,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return browserError('browser_navigate', /timeout/i.test(message) ? 'TIMEOUT' : 'NAVIGATION_FAILED', message.split('\n')[0]);
    }
  });
}

async function snapshot(session, args = {}) {
  return guard('browser_snapshot', async () => {
    const closed = requirePage(session, 'browser_snapshot');
    if (closed) return closed;
    const maxChars = pickInt(args.max_chars, resolveBrowserConfig(session.config).snapshot_max_chars, BROWSER_LIMITS.snapshotChars);
    if (maxChars.error) return browserError('browser_snapshot', 'INVALID_ARGUMENTS', maxChars.error);
    try {
      const captured = await captureSnapshot(session.cdp, session, { interactiveOnly: args.interactive_only === true });
      const title = await session.page.title();
      const url = session.page.url();
      const full = [`[snapshot url=${url} title=${JSON.stringify(title)} refs=${captured.refs.length}]`, ...captured.lines].join('\n');
      const incremental = args.incremental !== false && session.lastSnapshotText;
      const delta = incremental ? diffSnapshot(session.lastSnapshotText, full) : { useDelta: false, text: full };
      session.lastSnapshotText = full;
      const chosen = delta.useDelta ? delta.text : full;
      const clipped = clip(chosen, maxChars.value);
      return browserOk('browser_snapshot', {
        summary: clipped.text,
        url,
        title,
        incremental: delta.useDelta === true,
        truncated: clipped.truncated || captured.truncated,
        refs: captured.refs.map(({ ref, role, name }) => ({ ref, role, name })),
      });
    } catch (error) {
      return browserError('browser_snapshot', 'SNAPSHOT_FAILED', error instanceof Error ? error.message : String(error));
    }
  });
}

function parsedTarget(tool, args, required = true) {
  const parsed = validateTarget(args, { required });
  if (!parsed.ok) return { error: targetError(tool, parsed) };
  return parsed;
}

async function withTarget(session, tool, args, required = true) {
  const parsed = parsedTarget(tool, args, required);
  if (parsed.error) return parsed;
  if (!parsed.target) return { target: null, locator: null, selector: '' };
  const resolved = await resolveLocator(session, tool, parsed.target);
  if (resolved.error) return resolved;
  return { target: parsed.target, ...resolved };
}

async function click(session, args = {}) {
  return guard('browser_click', async () => {
    const parsed = parsedTarget('browser_click', args);
    if (parsed.error) return parsed.error;
    const closed = requirePage(session, 'browser_click');
    if (closed) return closed;
    const found = await withTarget(session, 'browser_click', args);
    if (found.error) return found.error;
    const timeout = pickInt(args.timeout_ms, BROWSER_LIMITS.actionTimeoutMs.default, BROWSER_LIMITS.actionTimeoutMs);
    const clicks = pickInt(args.click_count, BROWSER_LIMITS.clickCount.default, BROWSER_LIMITS.clickCount);
    if (timeout.error || clicks.error) return browserError('browser_click', 'INVALID_ARGUMENTS', timeout.error || clicks.error);
    try {
      await found.locator.click({
        button: args.button || 'left',
        clickCount: clicks.value,
        timeout: timeout.value,
      });
      return browserOk('browser_click', {
        summary: `Clicked ${describeTarget(found.target)}.`,
        target: found.target,
        action: 'click',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
      return browserError('browser_click', /timeout/i.test(message) ? 'TIMEOUT' : 'TARGET_NOT_ACTIONABLE', message);
    }
  });
}

async function typeText(session, args = {}) {
  return guard('browser_type', async () => {
    const text = typeof args.text === 'string' ? args.text : '';
    if (!text && args.clear !== true) {
      return browserError('browser_type', 'INVALID_ARGUMENTS', 'text is empty. Pass text, or set clear to true.');
    }
    const parsed = parsedTarget('browser_type', args);
    if (parsed.error) return parsed.error;
    const closed = requirePage(session, 'browser_type');
    if (closed) return closed;
    const found = await withTarget(session, 'browser_type', args);
    if (found.error) return found.error;
    const timeout = pickInt(args.timeout_ms, BROWSER_LIMITS.actionTimeoutMs.default, BROWSER_LIMITS.actionTimeoutMs);
    const delay = pickInt(args.delay_ms, BROWSER_LIMITS.typeDelayMs.default, BROWSER_LIMITS.typeDelayMs);
    if (timeout.error || delay.error) return browserError('browser_type', 'INVALID_ARGUMENTS', timeout.error || delay.error);
    try {
      if (args.clear === true) await found.locator.fill('', { timeout: timeout.value });
      if (text) {
        await found.locator.click({ timeout: timeout.value });
        await found.locator.pressSequentially(text, { delay: delay.value, timeout: timeout.value });
      }
      if (args.submit === true) await found.locator.press('Enter', { timeout: timeout.value });
      return browserOk('browser_type', {
        summary: `Typed ${text.length} characters into ${describeTarget(found.target)}${args.submit ? ' and pressed Enter' : ''}.`,
        target: found.target,
        typed_chars: text.length,
        submitted: args.submit === true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
      return browserError('browser_type', /timeout/i.test(message) ? 'TIMEOUT' : 'TARGET_NOT_ACTIONABLE', message);
    }
  });
}

async function evaluate(session, args = {}) {
  return guard('browser_eval', async () => {
    const closed = requirePage(session, 'browser_eval');
    if (closed) return closed;
    const expression = String(args.expression || '');
    if (!expression.trim()) return browserError('browser_eval', 'INVALID_ARGUMENTS', 'expression is required.');
    const timeout = pickInt(args.timeout_ms, BROWSER_LIMITS.actionTimeoutMs.default, BROWSER_LIMITS.actionTimeoutMs);
    if (timeout.error) return browserError('browser_eval', 'INVALID_ARGUMENTS', timeout.error);
    try {
      const value = await session.page.evaluate(async (source) => {
        const result = await (0, eval)(source);
        const seen = new WeakSet();
        const text = JSON.stringify(result, (_key, item) => {
          if (typeof item === 'function') return `[function ${item.name || 'anonymous'}]`;
          if (typeof item === 'bigint') return item.toString();
          if (item && typeof item === 'object') {
            if (seen.has(item)) return '[circular]';
            seen.add(item);
          }
          return item;
        });
        return text == null ? String(result) : text;
      }, expression);
      const clipped = clip(String(value ?? 'undefined'), 4000);
      return browserOk('browser_eval', {
        summary: clipped.text,
        value: clipped.text,
        truncated: clipped.truncated,
        timeout_ms: timeout.value,
      });
    } catch (error) {
      return browserError('browser_eval', 'EVAL_FAILED', error instanceof Error ? error.message.split('\n')[0] : String(error));
    }
  });
}

async function screenshot(session, args = {}) {
  return guard('browser_screenshot', async () => {
    const closed = requirePage(session, 'browser_screenshot');
    if (closed) return closed;
    const found = await withTarget(session, 'browser_screenshot', args, false);
    if (found.error) return found.error;
    const format = args.format || 'png';
    const quality = pickInt(args.quality, BROWSER_LIMITS.jpegQuality.default, BROWSER_LIMITS.jpegQuality);
    const timeout = pickInt(args.timeout_ms, BROWSER_LIMITS.actionTimeoutMs.default, BROWSER_LIMITS.actionTimeoutMs);
    if (quality.error || timeout.error) return browserError('browser_screenshot', 'INVALID_ARGUMENTS', quality.error || timeout.error);
    const directory = path.join(os.tmpdir(), 'codemini-browser');
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, `shot-${process.pid}-${Date.now()}.${format}`);
    const options = { path: file, type: format, timeout: timeout.value, ...(format === 'jpeg' ? { quality: quality.value } : {}) };
    const buffer = found.locator
      ? await found.locator.screenshot(options)
      : await session.page.screenshot({ ...options, fullPage: args.full_page === true });
    const box = found.locator ? await found.locator.boundingBox() : session.page.viewportSize();
    return browserOk('browser_screenshot', {
      summary: `Wrote ${format} screenshot (${buffer.length} bytes) to ${file}.`,
      path: file,
      format,
      bytes: buffer.length,
      width: Math.round(box?.width || 0),
      height: Math.round(box?.height || 0),
      full_page: !found.locator && args.full_page === true,
      target: found.target,
    });
  });
}

async function logs(session, args = {}) {
  return guard('browser_logs', async () => {
    const closed = requirePage(session, 'browser_logs');
    if (closed) return closed;
    const limit = pickInt(args.limit, BROWSER_LIMITS.logLimit.default, BROWSER_LIMITS.logLimit);
    if (limit.error) return browserError('browser_logs', 'INVALID_ARGUMENTS', limit.error);
    const entries = session.readLogs({
      since: args.since || 'last_read',
      kind: args.kind || 'all',
      level: args.level || 'all',
      limit: limit.value,
    });
    const summary = entries.length
      ? entries.map((entry) => `${entry.kind}/${entry.level}: ${entry.text}`).join('\n')
      : 'No log entries.';
    return browserOk('browser_logs', { summary, entries });
  });
}

async function close(session) {
  return guard('browser_close', async () => {
    const wasOpen = session.isOpen();
    await session.dispose();
    return browserOk('browser_close', {
      summary: wasOpen ? 'Closed the browser.' : 'Browser was already closed.',
      closed: true,
    });
  });
}

async function diagnose(session, args = {}) {
  return guard('browser_diagnose_click', async () => {
    const parsed = parsedTarget('browser_diagnose_click', args);
    if (parsed.error) return parsed.error;
    const closed = requirePage(session, 'browser_diagnose_click');
    if (closed) return closed;
    const found = await withTarget(session, 'browser_diagnose_click', args);
    if (found.error) return found.error;
    const observe = pickInt(args.observe_ms, BROWSER_LIMITS.observeMs.default, BROWSER_LIMITS.observeMs);
    const timeout = pickInt(args.timeout_ms, BROWSER_LIMITS.actionTimeoutMs.default, BROWSER_LIMITS.actionTimeoutMs);
    if (observe.error || timeout.error) return browserError('browser_diagnose_click', 'INVALID_ARGUMENTS', observe.error || timeout.error);
    const hit = found.selector ? await hitTest(session.page, session.cdp, found.selector).catch((error) => ({
      visible: false,
      reason: 'hit-test-failed',
      occluded: false,
      chain: [],
      top: null,
      error: error instanceof Error ? error.message : String(error),
    })) : null;
    if (hit?.reason === 'disabled') {
      return browserOk('browser_diagnose_click', {
        summary: `${describeTarget(found.target)} is disabled and was not clicked.`,
        target: found.target,
        click: { ok: false, code: 'TARGET_NOT_ACTIONABLE', error: 'Element is disabled.' },
        hit,
        console: [],
        exceptions: [],
        network: [],
        mutations: [],
      });
    }
    const probe = await probeClick(session.page, found.locator, { timeout: timeout.value, observeMs: observe.value });
    const lines = [
      `${describeTarget(found.target)}: ${probe.click.ok ? 'click ran' : `${probe.click.code} ${probe.click.error}`}`,
      hit ? `hit: ${hit.reason}${hit.top?.id ? ` top=#${hit.top.id}` : hit.top?.tag ? ` top=${hit.top.tag}` : ''}` : '',
      probe.exceptions.length ? `exceptions: ${probe.exceptions.map((item) => item.text).join(' | ')}` : 'exceptions: 0',
      probe.console.length ? `console: ${probe.console.map((item) => `${item.level} ${item.text}`).join(' | ')}` : 'console: 0',
      probe.network.length ? `network: ${probe.network.map((item) => `${item.method} ${item.url}`).join(' | ')}` : 'network: 0',
      probe.mutations.length ? `dom: ${probe.mutations.slice(0, 5).map((item) => `${item.type}${item.attribute ? ` ${item.attribute}` : ''} +${item.added}/-${item.removed}`).join('; ')}` : 'dom: 0',
    ].filter(Boolean);
    return browserOk('browser_diagnose_click', {
      summary: lines.join('\n'),
      target: found.target,
      click: probe.click,
      hit,
      console: probe.console,
      exceptions: probe.exceptions,
      network: probe.network,
      mutations: probe.mutations,
    });
  });
}

async function style(session, args = {}) {
  return guard('browser_explain_style', async () => {
    const parsed = parsedTarget('browser_explain_style', args);
    if (parsed.error) return parsed.error;
    const closed = requirePage(session, 'browser_explain_style');
    if (closed) return closed;
    const found = await withTarget(session, 'browser_explain_style', args);
    if (found.error) return found.error;
    const maxRules = pickInt(args.max_rules, BROWSER_LIMITS.maxRules.default, BROWSER_LIMITS.maxRules);
    if (maxRules.error) return browserError('browser_explain_style', 'INVALID_ARGUMENTS', maxRules.error);
    const properties = Array.isArray(args.properties) && args.properties.length
      ? args.properties.map((item) => String(item || '').trim()).filter((item) => /^[a-z-]{1,40}$/.test(item))
      : [...INTERACTION_STYLE_PROPS];
    const backendNodeId = await backendForSelector(session.cdp, found.selector);
    if (!backendNodeId) return browserError('browser_explain_style', 'TARGET_NOT_FOUND', 'The element is not in the DOM.');
    const explained = await explainStyle(session.cdp, backendNodeId, properties, maxRules.value);
    const hit = await hitTest(session.page, session.cdp, found.selector);
    const winningLine = explained.winning.slice(0, 6).map((item) => `${item.property}: ${item.value} <= ${item.selector}`).join('\n');
    const overriddenLine = explained.overridden.slice(0, 6).map((item) => `${item.property}: ${item.value} overridden by ${item.overridden_by}`).join('\n');
    return browserOk('browser_explain_style', {
      summary: [
        `${describeTarget(found.target)} hit=${hit.reason}`,
        winningLine ? `winning:\n${winningLine}` : 'winning: (none)',
        overriddenLine ? `overridden:\n${overriddenLine}` : '',
      ].filter(Boolean).join('\n'),
      target: found.target,
      computed: explained.computed,
      winning: explained.winning,
      overridden: explained.overridden,
      hit,
    });
  });
}

async function listeners(session, args = {}) {
  return guard('browser_listeners', async () => {
    const parsed = parsedTarget('browser_listeners', args);
    if (parsed.error) return parsed.error;
    const closed = requirePage(session, 'browser_listeners');
    if (closed) return closed;
    const found = await withTarget(session, 'browser_listeners', args);
    if (found.error) return found.error;
    const maxListeners = pickInt(args.max_listeners, BROWSER_LIMITS.maxListeners.default, BROWSER_LIMITS.maxListeners);
    if (maxListeners.error) return browserError('browser_listeners', 'INVALID_ARGUMENTS', maxListeners.error);
    const backendNodeId = await backendForSelector(session.cdp, found.selector);
    if (!backendNodeId) return browserError('browser_listeners', 'TARGET_NOT_FOUND', 'The element is not in the DOM.');
    const foundListeners = await listListeners(session.cdp, session, backendNodeId, {
      types: Array.isArray(args.types) ? args.types : [],
      maxListeners: maxListeners.value,
    });
    const summary = foundListeners.length
      ? foundListeners.map((listener) => {
        const place = listener.location?.file
          ? `${listener.location.file}:${listener.location.line}:${listener.location.column}`
          : 'unknown location';
        return `${listener.type} ${place}`;
      }).join('\n')
      : `No listeners on ${describeTarget(found.target)}.`;
    return browserOk('browser_listeners', {
      summary,
      target: found.target,
      listeners: foundListeners,
    });
  });
}

async function locate(session, args = {}) {
  return guard('browser_locate_source', async () => {
    const parsed = parsedTarget('browser_locate_source', args);
    if (parsed.error) return parsed.error;
    const closed = requirePage(session, 'browser_locate_source');
    if (closed) return closed;
    const found = await withTarget(session, 'browser_locate_source', args);
    if (found.error) return found.error;
    const locations = await locateSource(session.cdp, session, found.selector);
    if (!locations.length) {
      return browserError('browser_locate_source', 'SOURCE_NOT_FOUND', `No React, Vue, or listener source was found for ${describeTarget(found.target)}.`);
    }
    return browserOk('browser_locate_source', {
      summary: locations.map((location) => `${location.framework} ${location.component || ''} ${location.file}${location.line ? `:${location.line}` : ''}${location.column != null ? `:${location.column}` : ''}`.replace(/\s+/g, ' ').trim()).join('\n'),
      target: found.target,
      locations,
    });
  });
}

function retag(result, tool) {
  if (!result || typeof result !== 'object') return result;
  return { ...result, tool };
}

async function runChecked(tool, session, args, runners) {
  const checked = validateBrowserAction(tool, args);
  if (!checked.ok) return browserError(tool, checked.code, checked.error);
  const run = runners[checked.action];
  if (!run) {
    return browserError(tool, 'INVALID_ARGUMENTS', `${tool} action "${checked.action}" is not implemented.`);
  }
  return retag(await run(), tool);
}

const DIAGNOSE_PROBES = {
  click: (session, args) => diagnose(session, args),
};

export function buildBrowserHandlers(session) {
  return {
    browser_inspect: (args = {}) => runChecked('browser_inspect', session, args, {
      snapshot: () => snapshot(session, args),
      screenshot: () => screenshot(session, args),
      logs: () => logs(session, args),
      explain_style: () => style(session, args),
      listeners: () => listeners(session, args),
      locate_source: () => locate(session, args),
    }),
    browser_act: (args = {}) => runChecked('browser_act', session, args, {
      open: () => open(session, args),
      navigate: () => navigate(session, args),
      click: () => click(session, args),
      type: () => typeText(session, args),
      eval: () => evaluate(session, args),
      close: () => close(session),
    }),
    browser_diagnose: (args = {}) => runChecked('browser_diagnose', session, args, {
      click: () => DIAGNOSE_PROBES.click(session, args),
    }),
    performance_profile: (args = {}) => runPerformanceProfile(session, args),
  };
}

export function buildBrowserFormatters() {
  return Object.fromEntries(BROWSER_TOOL_NAMES.map((name) => [name, formatBrowserResult]));
}
