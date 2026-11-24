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
export const BROWSER_INSPECT_ACTIONS = Object.freeze([
  'snapshot', 'screenshot', 'logs', 'explain_style', 'listeners', 'locate_source',
]);
export const BROWSER_ACT_ACTIONS = Object.freeze([
  'open', 'navigate', 'click', 'type', 'eval', 'close',
]);
export const BROWSER_DIAGNOSE_ACTIONS = Object.freeze(['click']);

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
  'browser_inspect',
  'browser_act',
  'browser_diagnose',
]);

export const BROWSER_READONLY_TOOLS = Object.freeze([
  'browser_inspect',
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
  browser_inspect: 'Browser Inspect',
  browser_act: 'Browser Act',
  browser_diagnose: 'Browser Diagnose',
});

export const INTERACTION_STYLE_PROPS = Object.freeze([
  'display', 'visibility', 'opacity', 'pointer-events', 'cursor',
  'position', 'z-index', 'overflow', 'overflow-x', 'overflow-y',
  'width', 'height', 'transform', 'filter', 'user-select',
  'content-visibility', 'touch-action', 'color', 'background-color',
]);

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

const wideTimeoutProp = intProp(
  'Timeout in milliseconds. open and navigate allow 1000-120000 (default 30000). Other actions allow 200-30000 (default 5000). Values outside the chosen action return INVALID_ARGUMENTS.',
  { min: BROWSER_LIMITS.actionTimeoutMs.min, max: BROWSER_LIMITS.timeoutMs.max },
);

const sharedFields = {
  ...targetProperties,
  url: stringProp('http(s) URL, about:blank, or a workspace file. navigate requires it. open uses about:blank when omitted.', { maxLength: BROWSER_LIMITS.url }),
  channel: {
    type: 'string',
    enum: [...BROWSER_CHANNELS],
    description: 'open only. chrome, msedge, or chromium. Default is config browser.channel, then the first installed browser.',
  },
  executable_path: stringProp('open only. Browser executable. Overrides channel. A missing path returns BROWSER_LAUNCH_FAILED.', { minLength: 1, maxLength: 500 }),
  headless: { type: 'boolean', description: 'open only. Defaults to config browser.headless (true).' },
  viewport_width: intProp(`open only. Viewport width in CSS pixels. Defaults to ${BROWSER_LIMITS.viewportWidth.default}.`, BROWSER_LIMITS.viewportWidth),
  viewport_height: intProp(`open only. Viewport height in CSS pixels. Defaults to ${BROWSER_LIMITS.viewportHeight.default}.`, BROWSER_LIMITS.viewportHeight),
  wait_until: {
    type: 'string',
    enum: [...BROWSER_WAIT_UNTIL],
    description: 'navigate only. Defaults to domcontentloaded. networkidle can hang on long-polling pages.',
  },
  button: {
    type: 'string',
    enum: [...BROWSER_CLICK_BUTTONS],
    description: 'click only. Mouse button. Defaults to left.',
  },
  click_count: intProp(`click only. Defaults to ${BROWSER_LIMITS.clickCount.default}.`, BROWSER_LIMITS.clickCount),
  text: stringProp('type only. Text to insert. Empty text requires clear:true.', { maxLength: BROWSER_LIMITS.text }),
  clear: { type: 'boolean', description: 'type only. Clear the field before typing. Defaults to false.' },
  submit: { type: 'boolean', description: 'type only. Press Enter after typing. Defaults to false.' },
  delay_ms: intProp(`type only. Delay between keystrokes. Defaults to ${BROWSER_LIMITS.typeDelayMs.default}.`, BROWSER_LIMITS.typeDelayMs),
  expression: stringProp('eval only. JavaScript expression evaluated in the page. Do not wrap it in a function.', { maxLength: BROWSER_LIMITS.expression }),
  incremental: { type: 'boolean', description: 'snapshot only. Return a delta when it is smaller than the full tree. Defaults to true.' },
  interactive_only: { type: 'boolean', description: 'snapshot only. Omit non-interactive text. Defaults to false.' },
  max_chars: intProp(`snapshot only. Summary budget. Defaults to ${BROWSER_LIMITS.snapshotChars.default}.`, BROWSER_LIMITS.snapshotChars),
  full_page: { type: 'boolean', description: 'screenshot only. Capture the full scroll height. Ignored when a target is set. Defaults to false.' },
  format: {
    type: 'string',
    enum: [...BROWSER_SCREENSHOT_FORMATS],
    description: 'screenshot only. Defaults to png.',
  },
  quality: intProp(`screenshot only. JPEG quality. Ignored for png. Defaults to ${BROWSER_LIMITS.jpegQuality.default}.`, BROWSER_LIMITS.jpegQuality),
  since: {
    type: 'string',
    enum: [...BROWSER_LOG_SINCE],
    description: 'logs only. session reads from open. last_read continues after the previous logs call. Defaults to last_read.',
  },
  kind: {
    type: 'string',
    enum: [...BROWSER_LOG_KINDS],
    description: 'logs only. Defaults to all.',
  },
  level: {
    type: 'string',
    enum: [...BROWSER_LOG_LEVELS],
    description: 'logs only. warning includes warning and error. Defaults to all.',
  },
  limit: intProp(`logs only. Maximum entries. Defaults to ${BROWSER_LIMITS.logLimit.default}.`, BROWSER_LIMITS.logLimit),
  properties: {
    type: 'array',
    items: { type: 'string', minLength: 1, maxLength: 40 },
    minItems: BROWSER_LIMITS.styleProps.min,
    maxItems: BROWSER_LIMITS.styleProps.max,
    description: 'explain_style only. CSS property names. Defaults to the interaction set.',
  },
  max_rules: intProp(`explain_style only. Defaults to ${BROWSER_LIMITS.maxRules.default}.`, BROWSER_LIMITS.maxRules),
  types: {
    type: 'array',
    items: { type: 'string', minLength: 1, maxLength: 40 },
    minItems: BROWSER_LIMITS.listenerTypes.min,
    maxItems: BROWSER_LIMITS.listenerTypes.max,
    description: 'listeners only. Event names such as click. Omit for every listener up to max_listeners.',
  },
  max_listeners: intProp(`listeners only. Defaults to ${BROWSER_LIMITS.maxListeners.default}.`, BROWSER_LIMITS.maxListeners),
  observe_ms: intProp(`diagnose click only. Watch window after the click. Defaults to ${BROWSER_LIMITS.observeMs.default}.`, BROWSER_LIMITS.observeMs),
  timeout_ms: wideTimeoutProp,
};

export const BROWSER_TOOL_DEFINITIONS = {
  browser_inspect: define(
    'browser_inspect',
    'Read-only page inspection. action is snapshot, screenshot, logs, explain_style, listeners, or locate_source. explain_style, listeners, and locate_source need one target: ref (@eN), selector, or role plus name. Returns { ok, tool, summary, ... }. Does not change the page.',
    {
      action: { type: 'string', enum: [...BROWSER_INSPECT_ACTIONS], description: 'Which inspection to run.' },
      ...sharedFields,
    },
    ['action'],
  ),
  browser_act: define(
    'browser_act',
    'Change the page. action is open, navigate, click, type, eval, or close. navigate needs url. click and type need one target. type needs text, or clear:true. eval needs expression. Uses a temporary browser profile. Requires approval. Returns { ok, tool, summary, ... }.',
    {
      action: { type: 'string', enum: [...BROWSER_ACT_ACTIONS], description: 'Which page change to run.' },
      ...sharedFields,
    },
    ['action'],
  ),
  browser_diagnose: define(
    'browser_diagnose',
    'Probe an interaction and report what happened. action click hits the target, then records the CDP hit-test, console errors, exceptions, fetch/xhr calls, and DOM mutations. More probe actions can be added later. Needs one target. Requires approval. Returns { ok, tool, summary, click, hit, console, exceptions, network, mutations }.',
    {
      action: { type: 'string', enum: [...BROWSER_DIAGNOSE_ACTIONS], description: 'Probe to run. click is the first probe.' },
      ...sharedFields,
    },
    ['action'],
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
    'browser.enabled is on. Load browser_inspect, browser_act, or browser_diagnose with tool_search, then pass action.',
    'browser_inspect is read-only: snapshot, screenshot, logs, explain_style, listeners, locate_source.',
    'browser_act changes the page: open, navigate, click, type, eval, close. It follows approval.',
    'browser_diagnose probes an interaction. action click clicks and observes. More probes can be added. It follows approval.',
    'Target with exactly one of ref (@eN from snapshot), selector, or role plus name.',
    'Use the frontend-interaction-debug skill for the step-by-step workflow. The browser uses a temporary profile.',
  ].join('\n');
}
