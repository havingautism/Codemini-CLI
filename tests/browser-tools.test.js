import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createToolRegistry, ToolArgumentsError } from '../src/core/tool-registry.js';
import { getBuiltinTools } from '../src/core/tools.js';
import { toolRequiresUserApproval } from '../src/core/approval-policy.js';
import { loadConfig } from '../src/core/config-store.js';
import { buildDefaultSystemPrompt } from '../src/core/default-system-prompt.js';
import { formatToolDisplayName } from '../src/core/tool-display.js';
import { describeToolActivity } from '../src/tui/tool-activity/index.js';
import {
  buildExecutionModePromptBlock,
  resolveExecutionModeAllowedTools,
  resolveSubAgentToolAllowList,
} from '../src/core/chat-runtime.js';
import { handleDoctor } from '../src/commands/doctor.js';
import {
  BROWSER_ERROR_CODES,
  BROWSER_MUTATING_TOOLS,
  BROWSER_READONLY_TOOLS,
  BROWSER_TOOL_DEFINITIONS,
  BROWSER_TOOL_NAMES,
  buildBrowserDeferredEntries,
  resolveBrowserConfig,
} from '../src/core/browser/schema.js';
import { buildBrowserFormatters, buildBrowserHandlers } from '../src/core/browser/handlers.js';
import { createBrowserSession, playwrightCoreLoaded } from '../src/core/browser/session.js';
import { classifyDeclarations, diffSnapshot } from '../src/core/browser/cascade.js';
import { createSourceResolver, mapGeneratedPosition } from '../src/core/browser/sourcemap.js';
import { resolvePageUrl, validateTarget } from '../src/core/browser/target.js';
import { browserCandidates, findInstalledBrowsers } from '../src/core/browser/locate-browser.js';
import { formatBrowserResult } from '../src/core/browser/result.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const VALID_ARGS = {
  browser_inspect: { action: 'snapshot' },
  browser_act: { action: 'close' },
  browser_diagnose: { action: 'click', ref: '@e1' },
};

function registry() {
  const handlers = Object.fromEntries(BROWSER_TOOL_NAMES.map((name) => [name, async () => ({ ok: true, tool: name })]));
  return createToolRegistry({
    deferredDefinitions: BROWSER_TOOL_DEFINITIONS,
    handlers,
    formatters: buildBrowserFormatters(),
  });
}

test('browser tool schemas compile and reject unknown fields, enums, and bounds', () => {
  const tools = registry();
  assert.deepEqual(Object.keys(BROWSER_TOOL_DEFINITIONS), [...BROWSER_TOOL_NAMES]);
  for (const name of BROWSER_TOOL_NAMES) {
    const definition = BROWSER_TOOL_DEFINITIONS[name];
    assert.equal(definition.function.name, name);
    assert.equal(definition.function.parameters.additionalProperties, false);
    assert.ok(Array.isArray(definition.function.parameters.required));
    assert.equal(tools.validateArguments(name, VALID_ARGS[name])[name] === undefined || true, true);
    assert.throws(
      () => tools.validateArguments(name, { ...VALID_ARGS[name], extra: true }),
      (error) => error instanceof ToolArgumentsError,
    );
  }
  assert.throws(() => tools.validateArguments('browser_inspect', {}), ToolArgumentsError);
  assert.throws(() => tools.validateArguments('browser_inspect', { action: 'open' }), ToolArgumentsError);
  assert.throws(() => tools.validateArguments('browser_act', { action: 'open', channel: 'firefox' }), ToolArgumentsError);
  assert.throws(() => tools.validateArguments('browser_act', { action: 'open', viewport_width: 10 }), ToolArgumentsError);
  assert.throws(() => tools.validateArguments('browser_act', { action: 'navigate', wait_until: 'soon', url: 'https://example.com' }), ToolArgumentsError);
  assert.throws(() => tools.validateArguments('browser_inspect', { action: 'snapshot', max_chars: 10 }), ToolArgumentsError);
  assert.throws(() => tools.validateArguments('browser_act', { action: 'click', ref: 'e1' }), ToolArgumentsError);
  assert.throws(() => tools.validateArguments('browser_act', { action: 'click', ref: '@e1', button: 'back' }), ToolArgumentsError);
  assert.throws(() => tools.validateArguments('browser_inspect', { action: 'screenshot', format: 'gif' }), ToolArgumentsError);
  assert.throws(() => tools.validateArguments('browser_inspect', { action: 'logs', limit: 0 }), ToolArgumentsError);
  assert.throws(() => tools.validateArguments('browser_diagnose', { action: 'click', selector: '#a', observe_ms: 10 }), ToolArgumentsError);
  assert.doesNotThrow(() => tools.validateArguments('browser_inspect', { action: 'assert', expect: { state: 'text', selector: '#result', value: 'Saved' } }));
  assert.throws(() => tools.validateArguments('browser_diagnose', { action: 'click', selector: '#a', expect: { state: 'ready' } }), ToolArgumentsError);
  assert.throws(() => tools.validateArguments('browser_inspect', { action: 'explain_style', role: 'button', name: 'Save', max_rules: 0 }), ToolArgumentsError);
  assert.throws(() => tools.validateArguments('browser_act', { action: 'close', force: true }), ToolArgumentsError);
  assert.equal(tools.deferredDefinitions().browser_inspect.function.parameters.required.includes('action'), true);
  const keys = (name) => Object.keys(BROWSER_TOOL_DEFINITIONS[name].function.parameters.properties);
  const inspect = keys('browser_inspect');
  const act = keys('browser_act');
  const diagnose = keys('browser_diagnose');
  for (const foreign of ['url', 'expression', 'observe_ms', 'channel', 'text']) {
    assert.equal(inspect.includes(foreign), false, foreign);
  }
  for (const foreign of ['observe_ms', 'incremental', 'format', 'max_rules', 'max_listeners']) {
    assert.equal(act.includes(foreign), false, foreign);
  }
  assert.deepEqual(diagnose.sort(), ['action', 'expect', 'name', 'observe_ms', 'ref', 'role', 'selector', 'timeout_ms']);
  assert.throws(() => tools.validateArguments('browser_inspect', { action: 'snapshot', url: 'https://example.com' }), ToolArgumentsError);
  assert.throws(() => tools.validateArguments('browser_diagnose', { action: 'click', ref: '@e1', expression: '1' }), ToolArgumentsError);
});

test('target combinations return INVALID_TARGET before a browser launches', async () => {
  const session = createBrowserSession({ config: { browser: { enabled: true } }, workspaceRoot: repoRoot });
  const handlers = buildBrowserHandlers(session);
  const missing = await handlers.browser_act({ action: 'click' });
  assert.equal(missing.ok, false);
  assert.equal(missing.tool, 'browser_act');
  assert.equal(missing.code, 'INVALID_ARGUMENTS');
  assert.match(missing.error, /action "click" needs ref, selector, or role plus name/);
  const both = await handlers.browser_act({ action: 'click', ref: '@e1', selector: '#a' });
  assert.equal(both.code, 'INVALID_TARGET');
  assert.match(both.error, /only one/i);
  const roleOnly = await handlers.browser_act({ action: 'click', role: 'button' });
  assert.equal(roleOnly.code, 'INVALID_TARGET');
  assert.match(roleOnly.error, /name/);
  const nav = await handlers.browser_act({ action: 'navigate' });
  assert.equal(nav.code, 'INVALID_ARGUMENTS');
  assert.match(nav.error, /needs url/);
  const typed = await handlers.browser_act({ action: 'type', ref: '@e1' });
  assert.equal(typed.code, 'INVALID_ARGUMENTS');
  assert.match(typed.error, /text/);
  const closed = await handlers.browser_inspect({ action: 'snapshot' });
  assert.equal(closed.code, 'BROWSER_NOT_OPEN');
  const incomplete = await handlers.browser_inspect({ action: 'assert', expect: { state: 'text', selector: '#result' } });
  assert.equal(incomplete.code, 'INVALID_ARGUMENTS');
  const wrongPath = await handlers.browser_diagnose({ action: 'click', selector: '#save', expect: { state: 'url_path', value: '/plan?token=sample' } });
  assert.equal(wrongPath.code, 'INVALID_ARGUMENTS');
  const blocked = await handlers.browser_act({ action: 'open', url: 'file:///etc/passwd' });
  assert.equal(blocked.code, 'UNSUPPORTED_URL');
  const remote = await handlers.browser_act({ action: 'navigate', url: 'https://example.com' });
  assert.equal(remote.code, 'BROWSER_NOT_OPEN');
  assert.equal(playwrightCoreLoaded(), false);
  await session.dispose();
});

test('formatters and display strings stay compact and bilingual activity still renders', () => {
  const formatted = formatBrowserResult({
    ok: false,
    tool: 'browser_act',
    code: 'TARGET_NOT_FOUND',
    error: 'No element matched @e9.',
  });
  assert.equal(formatted, 'Error [TARGET_NOT_FOUND]: No element matched @e9.');
  assert.equal(formatBrowserResult({ ok: true, tool: 'browser_act', summary: 'Clicked @e1.' }), 'Clicked @e1.');
  assert.equal(formatToolDisplayName('browser_act', { action: 'click', ref: '@e1' }), 'Browser Act (click @e1)');
  const activity = describeToolActivity({ toolActivity: { doingGeneric: 'Doing', doneGeneric: 'Done', blocked: 'Blocked' } }, 'browser_act (click @e1)');
  assert.match(activity, /Browser Act/);
  for (const code of ['NOT_A_CODE']) assert.equal(BROWSER_ERROR_CODES.includes(code), false);
  assert.ok(BROWSER_ERROR_CODES.includes('INVALID_TARGET'));
  assert.deepEqual([...BROWSER_READONLY_TOOLS], ['browser_inspect']);
  assert.deepEqual([...BROWSER_MUTATING_TOOLS], ['browser_act', 'browser_diagnose']);
  assert.equal(BROWSER_READONLY_TOOLS.some((name) => BROWSER_MUTATING_TOOLS.includes(name)), false);
});

test('browser tools are deferred in coding mode and absent in normal mode', async () => {
  const normal = getBuiltinTools({ workspaceRoot: repoRoot, config: { execution: { mode: 'normal' } } });
  try {
    const normalNames = normal.definitions.map((item) => item.function.name);
    for (const name of BROWSER_TOOL_NAMES) {
      assert.equal(normalNames.includes(name), false, name);
      assert.equal(normal.deferredDefinitions[name], undefined, name);
      assert.equal(normal.handlers[name], undefined, name);
    }
    assert.equal(buildBrowserDeferredEntries({ execution: { mode: 'daily' } }).browser_act, undefined);
    assert.equal(playwrightCoreLoaded(), false);
  } finally {
    normal.dispose?.();
  }
  const coding = getBuiltinTools({ workspaceRoot: repoRoot, config: { execution: { mode: 'plan' } } });
  try {
    const codingNames = coding.definitions.map((item) => item.function.name);
    const registered = createToolRegistry(coding);
    for (const name of BROWSER_TOOL_NAMES) {
      assert.equal(codingNames.includes(name), false, name);
      assert.equal(coding.deferredDefinitions[name].function.name, name);
      assert.equal(typeof coding.handlers[name], 'function');
      const found = await coding.handlers.tool_search({ query: name });
      assert.equal(found.loaded.includes(name), true, name);
    }
    assert.equal(registered.isConcurrencySafe('browser_inspect', { action: 'snapshot' }), false);
    assert.equal(registered.isConcurrencySafe('browser_act', { action: 'click', ref: '@e1' }), false);
    const alsoCoding = getBuiltinTools({ workspaceRoot: repoRoot, config: { execution: { mode: 'coding' } } });
    try {
      assert.equal(alsoCoding.deferredDefinitions.browser_diagnose.function.name, 'browser_diagnose');
      assert.equal(alsoCoding.definitions.some((item) => item.function.name === 'browser_diagnose'), false);
    } finally {
      alsoCoding.dispose?.();
    }
  } finally {
    coding.dispose?.();
  }
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { getBuiltinTools } from './src/core/tools.js';
    import { playwrightCoreLoaded } from './src/core/browser/session.js';
    const bundle = getBuiltinTools({ workspaceRoot: process.cwd(), config: {} });
    console.log(JSON.stringify({
      tools: Object.keys(bundle.deferredDefinitions).filter((name) => name.startsWith('browser_')),
      loaded: playwrightCoreLoaded(),
    }));
    await bundle.dispose?.();
  `], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const payload = JSON.parse(child.stdout.trim().split('\n').pop());
  assert.deepEqual(payload.tools, []);
  assert.equal(payload.loaded, false);
});

test('coding mode auto-approves browser tools and mentions them only in the coding prompt', async () => {
  assert.equal(resolveBrowserConfig({ browser: { channel: 'chrome', headless: false } }).channel, 'chrome');
  assert.equal(resolveBrowserConfig({ browser: { headless: false } }).headless, false);
  assert.equal(Object.hasOwn(resolveBrowserConfig({ browser: { enabled: true } }), 'enabled'), false);
  const config = await loadConfig();
  assert.equal(Object.hasOwn(config.browser, 'enabled'), false);
  assert.equal(config.browser.headless, true);
  assert.equal(config.browser.channel, 'auto');
  assert.equal(config.execution.always_allow_tools.includes('browser_inspect'), false);
  const coding = resolveExecutionModeAllowedTools('coding', null, {});
  assert.equal(coding.includes('browser_inspect'), true);
  assert.equal(coding.includes('browser_act'), true);
  assert.equal(coding.includes('browser_diagnose'), true);
  assert.equal(coding.includes('run'), true);
  assert.equal(coding.includes('edit'), true);
  assert.equal(toolRequiresUserApproval({
    approvalMode: 'review',
    toolName: 'browser_act',
    alwaysAllowTools: coding,
  }), false);
  assert.equal(resolveExecutionModeAllowedTools('normal', null, { execution: { mode: 'plan' } }), null);
  assert.equal(resolveSubAgentToolAllowList({ role: 'debugger', config: { execution: { mode: 'normal' } } }).includes('browser_diagnose'), false);
  assert.equal(resolveSubAgentToolAllowList({ role: 'debugger', config: { execution: { mode: 'plan' } } }).includes('browser_diagnose'), true);
  assert.equal(resolveSubAgentToolAllowList({ role: 'explorer', config: { execution: { mode: 'plan' } } }).includes('browser_act'), false);
  const codingPrompt = buildExecutionModePromptBlock('coding');
  const normalPrompt = buildExecutionModePromptBlock('normal');
  assert.match(codingPrompt, /tool_search/);
  assert.match(codingPrompt, /browser_inspect/);
  assert.match(codingPrompt, /browser_act/);
  assert.match(codingPrompt, /browser_diagnose/);
  assert.match(codingPrompt, /frontend-interaction-debug/);
  assert.doesNotMatch(normalPrompt, /browser_inspect|browser_act|browser_diagnose|frontend-interaction-debug/);
  assert.doesNotMatch(buildDefaultSystemPrompt({ execution: { mode: 'plan' } }), /browser_inspect/);
  assert.doesNotMatch(buildDefaultSystemPrompt({ execution: { mode: 'normal' } }), /browser_inspect/);
});

test('doctor reports Chrome or Edge and skips the check when none is installed', async () => {
  const lines = [];
  const previous = process.exitCode;
  try {
    await handleDoctor({
      loadConfigFn: async () => ({
        gateway: { base_url: 'https://example.com/v1', api_key: 'token' },
        sandbox: { enabled: false, mode: 'workspace-write' },
        browser: {},
      }),
      checkPathWritableFn: async () => true,
      checkGatewayFn: async () => ({ ok: true, reason: 'reachable' }),
      commandExistsFn: async () => true,
      findInstalledBrowsersFn: () => [],
      checkMicrosandboxDoctorFn: async () => ({ ok: true, reason: 'unused' }),
      shouldCheckMicrosandboxFn: () => false,
      writeLine: (line) => lines.push(line),
    });
    assert.match(lines.join('\n'), /\[SKIP\] Local Chrome\/Edge: Chrome, Edge, or Chromium not found/);
  } finally {
    process.exitCode = previous ?? 0;
  }
  const found = [];
  await handleDoctor({
    loadConfigFn: async () => ({
      gateway: { base_url: 'https://example.com/v1', api_key: 'token' },
      sandbox: { enabled: false, mode: 'workspace-write' },
      browser: {},
    }),
    checkPathWritableFn: async () => true,
    checkGatewayFn: async () => ({ ok: true, reason: 'reachable' }),
    commandExistsFn: async () => true,
    findInstalledBrowsersFn: () => [{ name: 'Chrome', channel: 'chrome', path: 'C:\\Chrome\\chrome.exe' }],
    shouldCheckMicrosandboxFn: () => false,
    writeLine: (line) => found.push(line),
  });
  assert.match(found.join('\n'), /\[OK\] Local Chrome\/Edge: Chrome: C:\\Chrome\\chrome.exe/);
  process.exitCode = previous ?? 0;
});

test('cascade, snapshot delta, source maps, urls, and browser paths', async () => {
  const classified = classifyDeclarations({
    matchedCSSRules: [
      { rule: { origin: 'regular', selectorList: { selectors: [{ text: 'button.swatch' }] }, style: { cssProperties: [{ name: 'color', value: 'red' }] } } },
      { rule: { origin: 'regular', selectorList: { selectors: [{ text: 'button.swatch.primary' }] }, style: { cssProperties: [{ name: 'color', value: 'blue' }] } } },
    ],
  }, ['color']);
  assert.equal(classified.winning[0].value, 'blue');
  assert.equal(classified.overridden[0].value, 'red');
  const important = classifyDeclarations({
    matchedCSSRules: [
      { rule: { selectorList: { selectors: [{ text: '#btn' }] }, style: { cssProperties: [{ name: 'color', value: 'red', important: true }] } } },
      { rule: { selectorList: { selectors: [{ text: 'button' }] }, style: { cssProperties: [{ name: 'color', value: 'blue' }] } } },
    ],
  }, ['color']);
  assert.equal(important.winning[0].value, 'red');
  const same = diffSnapshot('[snapshot]\n@e1 button "Save"', '[snapshot]\n@e1 button "Save"');
  assert.match(same.text, /unchanged/);
  const changed = diffSnapshot('[snapshot]\n@e1 button "Save"', '[snapshot]\n@e1 button "Save"\n@e2 button "New"');
  assert.match(changed.text, /\+ @e2 button "New"/);
  const mapped = await mapGeneratedPosition({
    sourceMap: {
      version: 3,
      sources: ['src/handler-source.js'],
      names: [],
      mappings: 'AAAA;AACA;AACA',
    },
    line: 2,
    column: 1,
    oneBased: true,
  });
  assert.equal(mapped.source, 'src/handler-source.js');
  assert.equal(mapped.line, 2);
  const target = validateTarget({ role: 'button', name: 'Save' });
  assert.equal(target.ok, true);
  assert.equal(resolvePageUrl(repoRoot, 'https://example.com/docs').url, 'https://example.com/docs');
  assert.match(resolvePageUrl(repoRoot, 'javascript:alert(1)').error, /http/);
  const windows = browserCandidates({
    platform: 'win32',
    env: {
      PROGRAMFILES: 'C:\\Program Files',
      'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
      LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
    },
    pathEnv: '',
  });
  assert.ok(windows.some((item) => item.channel === 'msedge' && item.path.endsWith('msedge.exe')));
  const found = findInstalledBrowsers({
    platform: 'linux',
    pathEnv: '',
    exists: (file) => file === '/usr/bin/google-chrome',
  });
  assert.deepEqual(found.map((item) => item.channel), ['chrome']);
});

test('a relative CDP sourcemap resolves from the minified script URL', async () => {
  const workspaceRoot = path.join(repoRoot, 'tests/fixtures/browser/react19');
  const reads = [];
  const resolver = createSourceResolver({
    workspaceRoot,
    getScript: () => ({ scriptId: 'a', url: 'http://127.0.0.1/assets/app.min.js', sourceMapURL: './maps/ui.map' }),
    readText: async (url) => {
      reads.push(url);
      return JSON.stringify({ version: 3, sources: ['/src/Button.jsx'], names: [], mappings: 'KACA' });
    },
  });
  const location = await resolver.locate({ scriptId: 'a', line: 1, column: 6, oneBased: true });
  assert.deepEqual(reads, ['http://127.0.0.1/assets/maps/ui.map']);
  assert.equal(location.workspaceSource, 'src/Button.jsx');
  assert.equal(location.line, 2);
  assert.equal(location.column, 0);
});

test('frontend debug guidance looks up the component before DOM listeners', async () => {
  const skill = await fs.readFile(path.join(repoRoot, 'templates/skills/frontend-interaction-debug/SKILL.md'), 'utf8');
  const locate = skill.indexOf('action:"locate_source"');
  const listeners = skill.indexOf('action:"listeners"');
  assert.ok(locate > 0 && listeners > locate);
  assert.match(skill, /edit that file with `edit`/);
  assert.match(skill, /sourcemaps/i);
  assert.match(skill, /react-dom/);
  const description = BROWSER_TOOL_DEFINITIONS.browser_inspect.function.description;
  assert.match(description, /locate_source maps a React or Vue node/);
  assert.match(description, /root delegate in react-dom/);
});

test('settings and i18n expose browser controls in English and Chinese', async () => {
  const en = await fs.readFile(path.join(repoRoot, 'codemini-web/client/i18n/en.js'), 'utf8');
  const zh = await fs.readFile(path.join(repoRoot, 'codemini-web/client/i18n/zh.js'), 'utf8');
  const settings = await fs.readFile(path.join(repoRoot, 'codemini-web/client/src/lib/settings-config.js'), 'utf8');
  const options = await fs.readFile(path.join(repoRoot, 'codemini-web/client/src/lib/settings-options.js'), 'utf8');
  for (const key of ['browserChannel', 'browserHeadless', 'hookTool_browser_diagnose', 'hookTool_browser_inspect', 'hookTool_browser_act']) {
    assert.match(en, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
  assert.doesNotMatch(en, /browserEnabled:/);
  assert.doesNotMatch(zh, /browserEnabled:/);
  assert.doesNotMatch(settings, /path: "browser\.enabled"/);
  assert.match(settings, /path: "browser\.channel"/);
  assert.match(options, /value: "msedge"/);
});
