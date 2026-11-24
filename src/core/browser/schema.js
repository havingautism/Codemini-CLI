/**
 * Browser diagnostic tool schemas and config.
 * This module must stay free of Node and Playwright imports so the Web UI can
 * read labels, and so importing the CLI does not load playwright-core.
 */

export const BROWSER_CHANNELS = Object.freeze(['chrome', 'msedge', 'chromium']);
export const BROWSER_WAIT_UNTIL = Object.freeze(['commit', 'domcontentloaded', 'load', 'networkidle']);
export const BROWSER_SCREENSHOT_FORMATS = Object.freeze(['png', 'jpeg']);
export const BROWSER_CLICK_BUTTONS = Object.freeze(['left', 'right', 'middle']);
export const BROWSER_LOG_SINCE = Object.freeze(['session', 'last_read']);
export const BROWSER_LOG_KINDS = Object.freeze(['all', 'console', 'exception', 'network']);
export const BROWSER_LOG_LEVELS = Object.freeze(['all', 'warning', 'error']);
export const BROWSER_ROLES = Object.freeze([
  'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox',
  'switch', 'tab', 'menuitem', 'option', 'slider', 'heading', 'img', 'listitem', 'treeitem',
]);

export const BROWSER_LIMITS = Object.freeze({
  url: 2000,
  timeoutMs: Object.freeze({ min: 1000, max: 120000, default: 30000 }),
  actionTimeoutMs: Object.freeze({ min: 200, max: 30000, default: 5000 }),
  observeMs: Object.freeze({ min: 100, max: 3000, default: 500 }),
  snapshotChars: Object.freeze({ min: 400, max: 20000, default: 6000 }),
  viewportWidth: Object.freeze({ min: 320, max: 3840, default: 1280 }),
  viewportHeight: Object.freeze({ min: 240, max: 2160, default: 800 }),
  expression: 8000,
  text: 8000,
  selector: 500,
  name: 200,
  ref: 16,
  logLimit: Object.freeze({ min: 1, max: 100, default: 40 }),
  maxRules: Object.freeze({ min: 1, max: 40, default: 12 }),
  maxListeners: Object.freeze({ min: 1, max: 50, default: 20 }),
  typeDelayMs: Object.freeze({ min: 0, max: 200, default: 0 }),
  jpegQuality: Object.freeze({ min: 1, max: 100, default: 80 }),
  clickCount: Object.freeze({ min: 1, max: 3, default: 1 }),
  styleProps: Object.freeze({ min: 1, max: 20 }),
  listenerTypes: Object.freeze({ min: 1, max: 10 }),
});

export const BROWSER_TOOL_NAMES = Object.freeze([
  'browser_open',
  'browser_navigate',
  'browser_snapshot',
  'browser_click',
  'browser_type',
  'browser_eval',
  'browser_screenshot',
  'browser_logs',
  'browser_close',
  'browser_diagnose_click',
  'browser_explain_style',
  'browser_listeners',
  'browser_locate_source',
]);

export const BROWSER_READONLY_TOOLS = Object.freeze([
  'browser_snapshot',
  'browser_screenshot',
  'browser_logs',
  'browser_explain_style',
  'browser_listeners',
  'browser_locate_source',
]);

export const BROWSER_MUTATING_TOOLS = Object.freeze(
  BROWSER_TOOL_NAMES.filter((name) => !BROWSER_READONLY_TOOLS.includes(name)),
);

export const BROWSER_ERROR_CODES = Object.freeze([
  'INVALID_TARGET',
  'INVALID_ARGUMENTS',
  'BROWSER_NOT_OPEN',
  'BROWSER_ALREADY_OPEN',
  'BROWSER_LAUNCH_FAILED',
  'NAVIGATION_FAILED',
  'UNSUPPORTED_URL',
  'TARGET_NOT_FOUND',
  'AMBIGUOUS_TARGET',
  'TARGET_NOT_ACTIONABLE',
  'TIMEOUT',
  'EVAL_FAILED',
  'SNAPSHOT_FAILED',
  'SOURCE_NOT_FOUND',
  'BROWSER_ERROR',
]);

export const BROWSER_TOOL_LABELS = Object.freeze({
  browser_open: 'Browser Open',
  browser_navigate: 'Browser Navigate',
  browser_snapshot: 'Browser Snapshot',
  browser_click: 'Browser Click',
  browser_type: 'Browser Type',
  browser_eval: 'Browser Eval',
  browser_screenshot: 'Browser Screenshot',
  browser_logs: 'Browser Logs',
  browser_close: 'Browser Close',
  browser_diagnose_click: 'Diagnose Click',
  browser_explain_style: 'Explain Style',
  browser_listeners: 'Event Listeners',
  browser_locate_source: 'Locate Source',
});

export const INTERACTION_STYLE_PROPS = Object.freeze([
  'display', 'visibility', 'opacity', 'pointer-events', 'cursor',
  'position', 'z-index', 'overflow', 'overflow-x', 'overflow-y',
  'width', 'height', 'transform', 'filter', 'user-select',
  'content-visibility', 'touch-action', 'color', 'background-color',
]);

const TARGET_HINT = 'Target with exactly one of: ref (@eN from the latest browser_snapshot), selector (CSS), or role plus name. Combining them returns INVALID_TARGET.';

function intProp(description, { min, max }) {
  return { type: 'integer', minimum: min, maximum: max, description };
}

function stringProp(description, extra = {}) {
  return { type: 'string', description, ...extra };
}

const targetProperties = {
  ref: stringProp(
    'Element ref from the latest browser_snapshot, such as @e3. Preferred. Do not combine with selector or role.',
    { pattern: '^@e[1-9][0-9]*$', maxLength: BROWSER_LIMITS.ref },
  ),
  selector: stringProp(
    'CSS selector, evaluated in the page. Do not combine with ref or role.',
    { minLength: 1, maxLength: BROWSER_LIMITS.selector },
  ),
  role: {
    type: 'string',
    enum: [...BROWSER_ROLES],
    description: 'ARIA role. Requires name. Do not combine with ref or selector. Example: button.',
  },
  name: stringProp(
    'Accessible name paired with role, for example Save. Substring match. Do not pass name alone.',
    { minLength: 1, maxLength: BROWSER_LIMITS.name },
  ),
};

function parameters(properties, required = []) {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required,
  };
}

function define(name, description, properties, required = []) {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: parameters(properties, required),
    },
  };
}

const timeoutProp = (fallback) => intProp(
  `Timeout in milliseconds. Defaults to ${fallback}.`,
  BROWSER_LIMITS.actionTimeoutMs,
);

const navigationTimeoutProp = intProp(
  `Navigation timeout in milliseconds. Defaults to ${BROWSER_LIMITS.timeoutMs.default}.`,
  BROWSER_LIMITS.timeoutMs,
);

export const BROWSER_TOOL_DEFINITIONS = {
  browser_open: define(
    'browser_open',
    [
      'Open the session browser for front-end interaction diagnostics. One shared Chrome, Edge, or Chromium per session, launched with a temporary profile (never the user\'s daily profile).',
      'Call this before the other browser tools. Pass url to open an http(s) URL, about:blank, or a file inside the workspace.',
      'Requires approval. Returns { ok, url, title, channel, headless, viewport }.',
    ].join(' '),
    {
      url: stringProp('Optional http(s) URL, about:blank, or workspace file path. Defaults to about:blank.', { maxLength: BROWSER_LIMITS.url }),
      channel: {
        type: 'string',
        enum: [...BROWSER_CHANNELS],
        description: 'Browser channel. Defaults to config browser.channel, then the first installed Chrome, Edge, or Chromium. chromium uses a discovered Chromium binary because playwright-core does not download browsers.',
      },
      executable_path: stringProp('Optional browser executable. Overrides channel. A missing path returns BROWSER_LAUNCH_FAILED and does not fall back to another browser.', { minLength: 1, maxLength: 500 }),
      headless: { type: 'boolean', description: 'Run headless. Defaults to config browser.headless (true).' },
      viewport_width: intProp(`Viewport width in CSS pixels. Defaults to ${BROWSER_LIMITS.viewportWidth.default}.`, BROWSER_LIMITS.viewportWidth),
      viewport_height: intProp(`Viewport height in CSS pixels. Defaults to ${BROWSER_LIMITS.viewportHeight.default}.`, BROWSER_LIMITS.viewportHeight),
      timeout_ms: navigationTimeoutProp,
    },
  ),
  browser_navigate: define(
    'browser_navigate',
    'Navigate the open page. http(s), about:blank, or a workspace file only. Requires approval. Returns { ok, url, title, status, wait_until }. Call browser_open first.',
    {
      url: stringProp('http(s) URL, about:blank, or a file path inside the workspace.', { minLength: 1, maxLength: BROWSER_LIMITS.url }),
      wait_until: {
        type: 'string',
        enum: [...BROWSER_WAIT_UNTIL],
        description: 'Navigation wait state. Defaults to domcontentloaded. networkidle waits for a quiet network and can hang on long-polling pages.',
      },
      timeout_ms: navigationTimeoutProp,
    },
    ['url'],
  ),
  browser_snapshot: define(
    'browser_snapshot',
    'Read-only accessibility snapshot of the current page. Interactive elements get stable @eN refs for later tools. incremental (default) returns a line delta when the page changed little. Returns { ok, url, title, incremental, truncated, refs, summary }. Refs stay valid after a delta.',
    {
      incremental: { type: 'boolean', description: 'Return a compact delta against the previous snapshot when it is smaller. Defaults to true.' },
      interactive_only: { type: 'boolean', description: 'Omit non-interactive text such as headings and static text. Defaults to false.' },
      max_chars: intProp(`Maximum summary characters. Defaults to config browser.snapshot_max_chars (${BROWSER_LIMITS.snapshotChars.default}). Longer output is truncated here; anything still over the tool-result budget spills to the tool-result store.`, BROWSER_LIMITS.snapshotChars),
    },
  ),
  browser_click: define(
    'browser_click',
    `Click an element. ${TARGET_HINT} Requires approval. Returns { ok, target, action }. A covered, disabled, or pointer-events:none element returns TARGET_NOT_ACTIONABLE; use browser_diagnose_click to see why.`,
    {
      ...targetProperties,
      button: {
        type: 'string',
        enum: [...BROWSER_CLICK_BUTTONS],
        description: 'Mouse button. Defaults to left.',
      },
      click_count: intProp(`Number of clicks. Defaults to ${BROWSER_LIMITS.clickCount.default}.`, BROWSER_LIMITS.clickCount),
      timeout_ms: timeoutProp(BROWSER_LIMITS.actionTimeoutMs.default),
    },
  ),
  browser_type: define(
    'browser_type',
    `Type into an element. ${TARGET_HINT} Requires approval. Returns { ok, target, typed_chars, submitted }. Set clear to replace existing text. Set submit to press Enter after typing.`,
    {
      ...targetProperties,
      text: stringProp('Text to type. Use an empty string only together with clear.', { maxLength: BROWSER_LIMITS.text }),
      clear: { type: 'boolean', description: 'Clear the field before typing. Defaults to false.' },
      submit: { type: 'boolean', description: 'Press Enter after typing. Defaults to false.' },
      delay_ms: intProp(`Delay between keystrokes in milliseconds. Defaults to ${BROWSER_LIMITS.typeDelayMs.default}.`, BROWSER_LIMITS.typeDelayMs),
      timeout_ms: timeoutProp(BROWSER_LIMITS.actionTimeoutMs.default),
    },
    ['text'],
  ),
  browser_eval: define(
    'browser_eval',
    'Evaluate a JavaScript expression in the page. The expression can read or change the page, so this requires approval. Returns { ok, value, truncated }. Value is JSON, truncated to 4000 characters. Errors return EVAL_FAILED.',
    {
      expression: stringProp('JavaScript expression. Do not wrap it in a function.', { minLength: 1, maxLength: BROWSER_LIMITS.expression }),
      timeout_ms: timeoutProp(BROWSER_LIMITS.actionTimeoutMs.default),
    },
    ['expression'],
  ),
  browser_screenshot: define(
    'browser_screenshot',
    `Capture a PNG or JPEG and write it to a temp file. Read-only. ${TARGET_HINT} Omit the target for the viewport, or set full_page. A target captures that element and ignores full_page. Returns { ok, path, format, bytes, width, height }. The image is not inlined.`,
    {
      ...targetProperties,
      full_page: { type: 'boolean', description: 'Capture the full scroll height. Defaults to false. Ignored when a target is set.' },
      format: {
        type: 'string',
        enum: [...BROWSER_SCREENSHOT_FORMATS],
        description: 'Image format. Defaults to png.',
      },
      quality: intProp(`JPEG quality from 1 to 100. Defaults to ${BROWSER_LIMITS.jpegQuality.default}. Ignored for png.`, BROWSER_LIMITS.jpegQuality),
      timeout_ms: timeoutProp(BROWSER_LIMITS.actionTimeoutMs.default),
    },
  ),
  browser_logs: define(
    'browser_logs',
    'Read-only. Return console messages, page exceptions, and document/xhr/fetch network entries buffered since browser_open. Returns { ok, entries }. last_read (default) advances the cursor; session rereads from the start without moving it.',
    {
      since: {
        type: 'string',
        enum: [...BROWSER_LOG_SINCE],
        description: 'session reads from browser_open. last_read reads entries after the previous last_read call. Defaults to last_read.',
      },
      kind: {
        type: 'string',
        enum: [...BROWSER_LOG_KINDS],
        description: 'Which buffer to include. Defaults to all.',
      },
      level: {
        type: 'string',
        enum: [...BROWSER_LOG_LEVELS],
        description: 'Console level filter. warning includes warning and error. Exceptions are errors. Defaults to all.',
      },
      limit: intProp(`Maximum entries, newest last. Defaults to ${BROWSER_LIMITS.logLimit.default}.`, BROWSER_LIMITS.logLimit),
    },
  ),
  browser_close: define(
    'browser_close',
    'Close the session browser and drop snapshot refs. Requires approval. Returns { ok, closed }. Safe to call when no browser is open.',
    {},
  ),
  browser_diagnose_click: define(
    'browser_diagnose_click',
    `Click a control, then watch for about ${BROWSER_LIMITS.observeMs.default}ms. ${TARGET_HINT} Requires approval because it clicks. Reports the CDP hit-test (including pointer-events:none), whether something occludes the target, console errors, exceptions, fetch/xhr calls, and DOM mutations. Returns { ok, target, click, hit, console, exceptions, network, mutations }.`,
    {
      ...targetProperties,
      observe_ms: intProp(`How long to watch after the click, in milliseconds. Defaults to ${BROWSER_LIMITS.observeMs.default}.`, BROWSER_LIMITS.observeMs),
      timeout_ms: timeoutProp(BROWSER_LIMITS.actionTimeoutMs.default),
    },
  ),
  browser_explain_style: define(
    'browser_explain_style',
    `Read-only. Explain the interaction-relevant computed style, the winning CSS rule, and overridden declarations from CSS.getMatchedStylesForNode, plus a CDP hit-test at the element center. ${TARGET_HINT} Returns { ok, target, computed, winning, overridden, hit }.`,
    {
      ...targetProperties,
      properties: {
        type: 'array',
        items: { type: 'string', minLength: 1, maxLength: 40 },
        minItems: BROWSER_LIMITS.styleProps.min,
        maxItems: BROWSER_LIMITS.styleProps.max,
        description: 'CSS property names to explain, such as color or pointer-events. Defaults to the interaction set (display, visibility, opacity, pointer-events, position, z-index, overflow, and color).',
      },
      max_rules: intProp(`Maximum winning or overridden declarations to return. Defaults to ${BROWSER_LIMITS.maxRules.default}.`, BROWSER_LIMITS.maxRules),
    },
  ),
  browser_listeners: define(
    'browser_listeners',
    `Read-only. List DOM event listeners from DOMDebugger.getEventListeners and map scriptId/line/column, or [[FunctionLocation]], through source maps to workspace files. ${TARGET_HINT} Returns { ok, target, listeners: [{ type, capture, passive, once, location }] }.`,
    {
      ...targetProperties,
      types: {
        type: 'array',
        items: { type: 'string', minLength: 1, maxLength: 40 },
        minItems: BROWSER_LIMITS.listenerTypes.min,
        maxItems: BROWSER_LIMITS.listenerTypes.max,
        description: 'Optional event type filter, for example ["click"]. Omit to return every listener up to max_listeners.',
      },
      max_listeners: intProp(`Maximum listeners. Defaults to ${BROWSER_LIMITS.maxListeners.default}.`, BROWSER_LIMITS.maxListeners),
    },
  ),
  browser_locate_source: define(
    'browser_locate_source',
    `Read-only. Map an element to source. React: __reactFiber _debugSource (React 18) or _debugStack/_debugInfo plus source maps (React 19). Vue: __vueParentComponent.type.__file. If the node has no component source, fall back to listener locations. ${TARGET_HINT} Returns { ok, target, locations: [{ framework, component, file, line, column }] } or SOURCE_NOT_FOUND.`,
    {
      ...targetProperties,
    },
  ),
};

export function buildBrowserDeferredEntries(config) {
  if (!browserToolsEnabled(config)) return {};
  return BROWSER_TOOL_DEFINITIONS;
}

function clampInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function resolveBrowserConfig(config = {}) {
  const raw = config?.browser && typeof config.browser === 'object' ? config.browser : {};
  const channel = String(raw.channel || '').trim().toLowerCase();
  return {
    enabled: raw.enabled === true || String(raw.enabled).toLowerCase() === 'true',
    channel: BROWSER_CHANNELS.includes(channel) ? channel : 'auto',
    executable_path: String(raw.executable_path || '').trim(),
    headless: !(raw.headless === false || String(raw.headless).toLowerCase() === 'false'),
    snapshot_max_chars: clampInt(
      raw.snapshot_max_chars,
      BROWSER_LIMITS.snapshotChars.default,
      BROWSER_LIMITS.snapshotChars.min,
      BROWSER_LIMITS.snapshotChars.max,
    ),
    timeout_ms: clampInt(
      raw.timeout_ms,
      BROWSER_LIMITS.timeoutMs.default,
      BROWSER_LIMITS.timeoutMs.min,
      BROWSER_LIMITS.timeoutMs.max,
    ),
    viewport_width: clampInt(
      raw.viewport_width,
      BROWSER_LIMITS.viewportWidth.default,
      BROWSER_LIMITS.viewportWidth.min,
      BROWSER_LIMITS.viewportWidth.max,
    ),
    viewport_height: clampInt(
      raw.viewport_height,
      BROWSER_LIMITS.viewportHeight.default,
      BROWSER_LIMITS.viewportHeight.min,
      BROWSER_LIMITS.viewportHeight.max,
    ),
  };
}

export function browserToolsEnabled(config) {
  return resolveBrowserConfig(config).enabled === true;
}

export function filterBrowserToolNames(names, config) {
  if (!Array.isArray(names)) return names;
  if (browserToolsEnabled(config)) return names;
  const drop = new Set(BROWSER_TOOL_NAMES);
  return names.filter((name) => !drop.has(name));
}

export function getBrowserToolGuidance(config) {
  if (!browserToolsEnabled(config)) return '';
  return [
    '# Browser diagnostics',
    'browser.enabled is on. The browser tools are deferred: load a tool with tool_search before calling it.',
    'Call browser_open first. It launches Chrome, Edge, or Chromium with a temporary profile, never the daily user profile.',
    'Then call browser_snapshot. Target later actions with an @eN ref. A CSS selector or role plus accessible name is a fallback; pass only one targeting mode.',
    'Read-only tools: browser_snapshot, browser_screenshot, browser_logs, browser_explain_style, browser_listeners, browser_locate_source.',
    'browser_open, browser_navigate, browser_click, browser_type, browser_eval, browser_diagnose_click, and browser_close change state and follow the normal approval flow.',
    'Use browser_diagnose_click when a control does not respond, browser_explain_style when the computed style looks wrong, and browser_listeners plus browser_locate_source when you need the handler and the workspace file:line.',
  ].join('\n');
}
