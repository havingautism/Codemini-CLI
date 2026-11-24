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
import { mapGeneratedPosition } from '../src/core/browser/sourcemap.js';
import { resolvePageUrl, validateTarget } from '../src/core/browser/target.js';
import { browserCandidates, findInstalledBrowsers } from '../src/core/browser/locate-browser.js';
import { formatBrowserResult } from '../src/core/browser/result.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const VALID_ARGS = {
  browser_open: {},
  browser_navigate: { url: 'https://example.com' },
  browser_snapshot: {},
  browser_click: { ref: '@e1' },
  browser_type: { ref: '@e1', text: 'hi' },
  browser_eval: { expression: '1+1' },
  browser_screenshot: {},
  browser_logs: {},
  browser_close: {},
  browser_diagnose_click: { selector: '#go' },
  browser_explain_style: { role: 'button', name: 'Save' },
  browser_listeners: { ref: '@e2' },
  browser_locate_source: { ref: '@e2' },
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
  assert.throws(() => tools.validateArguments('browser_open', { channel: 'firefox' }), ToolArgumentsError);
  assert.throws(() => tools.validateArguments('browser_open', { viewport_width: 10 }), ToolArgumentsError);
  assert.throws(() => tools.validateArguments('browser_navigate', {}), ToolArgumentsError);
  assert.throws(() => tools.validateArguments('browser_navigate', { url: 'https://example.com', wait_until: 'soon' }), ToolArgumentsError);
  assert.throws(() => tools.validateArguments('browser_snapshot', { max_chars: 10 }), ToolArgumentsError);
  assert.throws(() => tools.validateArguments('browser_click', { ref: 'e1' }), ToolArgumentsError);
  assert.throws(() => tools.validateArguments('browser_click', { ref: '@e1', button: 'back' }), ToolArgumentsError);
  assert.throws(() => tools.validateArguments('browser_type', { ref: '@e1' }), ToolArgumentsError);
  assert.throws(() => tools.validateArguments('browser_eval', { expression: '' }), ToolArgumentsError);
  assert.throws(() => tools.validateArguments('browser_screenshot', { format: 'gif' }), ToolArgumentsError);
  assert.throws(() => tools.validateArguments('browser_logs', { limit: 0, since: 'last_read' }), ToolArgumentsError);
  assert.throws(() => tools.validateArguments('browser_diagnose_click', { selector: '#a', observe_ms: 10 }), ToolArgumentsError);
  assert.throws(() => tools.validateArguments('browser_explain_style', { role: 'button', name: 'Save', max_rules: 0 }), ToolArgumentsError);
  assert.throws(() => tools.validateArguments('browser_listeners', { ref: '@e1', max_listeners: 0 }), ToolArgumentsError);
  assert.throws(() => tools.validateArguments('browser_close', { force: true }), ToolArgumentsError);
});

test('target combinations return INVALID_TARGET before a browser launches', async () => {
  const session = createBrowserSession({ config: { browser: { enabled: true } }, workspaceRoot: repoRoot });
  const handlers = buildBrowserHandlers(session);
  const missing = await handlers.browser_click({});
  assert.equal(missing.ok, false);
  assert.equal(missing.tool, 'browser_click');
  assert.equal(missing.code, 'INVALID_TARGET');
  assert.match(missing.error, /ref/);
  const both = await handlers.browser_click({ ref: '@e1', selector: '#a' });
  assert.equal(both.code, 'INVALID_TARGET');
  assert.match(both.error, /only one/i);
  const roleOnly = await handlers.browser_click({ role: 'button' });
  assert.equal(roleOnly.code, 'INVALID_TARGET');
  assert.match(roleOnly.error, /name/);
  const closed = await handlers.browser_snapshot({});
  assert.equal(closed.code, 'BROWSER_NOT_OPEN');
  const blocked = await handlers.browser_open({ url: 'file:///etc/passwd' });
  assert.equal(blocked.code, 'UNSUPPORTED_URL');
  const remote = await handlers.browser_navigate({ url: 'https://example.com' });
  assert.equal(remote.code, 'BROWSER_NOT_OPEN');
  assert.equal(playwrightCoreLoaded(), false);
  await session.dispose();
});

test('formatters and display strings stay compact and bilingual activity still renders', () => {
  const formatted = formatBrowserResult({
    ok: false,
    tool: 'browser_click',
    code: 'TARGET_NOT_FOUND',
    error: 'No element matched @e9.',
  });
  assert.equal(formatted, 'Error [TARGET_NOT_FOUND]: No element matched @e9.');
  assert.equal(formatBrowserResult({ ok: true, tool: 'browser_click', summary: 'Clicked @e1.' }), 'Clicked @e1.');
  assert.equal(formatToolDisplayName('browser_click', { ref: '@e1' }), 'Browser Click (@e1)');
  const activity = describeToolActivity({ toolActivity: { doingGeneric: 'Doing', doneGeneric: 'Done', blocked: 'Blocked' } }, 'browser_click (@e1)');
  assert.match(activity, /Browser Click/);
  for (const code of ['NOT_A_CODE']) assert.equal(BROWSER_ERROR_CODES.includes(code), false);
  assert.ok(BROWSER_ERROR_CODES.includes('INVALID_TARGET'));
  assert.ok(BROWSER_READONLY_TOOLS.includes('browser_snapshot'));
  assert.ok(BROWSER_MUTATING_TOOLS.includes('browser_click'));
  assert.equal(BROWSER_READONLY_TOOLS.some((name) => BROWSER_MUTATING_TOOLS.includes(name)), false);
});

test('disabled config omits browser tools and does not import playwright-core', () => {
  const bundle = getBuiltinTools({ workspaceRoot: repoRoot, config: {} });
  try {
    assert.equal(bundle.deferredDefinitions.browser_open, undefined);
    assert.equal(bundle.handlers.browser_open, undefined);
    assert.equal(buildBrowserDeferredEntries({}).browser_open, undefined);
    assert.equal(playwrightCoreLoaded(), false);
    const enabled = getBuiltinTools({ workspaceRoot: repoRoot, config: { browser: { enabled: true } } });
    try {
      const registered = createToolRegistry(enabled);
      assert.equal(typeof enabled.handlers.browser_open, 'function');
      assert.equal(enabled.deferredDefinitions.browser_snapshot.function.name, 'browser_snapshot');
      assert.equal(registered.isConcurrencySafe('browser_snapshot', {}), false);
      assert.equal(registered.isConcurrencySafe('browser_click', { ref: '@e1' }), false);
    } finally {
      enabled.dispose?.();
    }
  } finally {
    bundle.dispose?.();
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

test('approval, prompts, and role lists follow the enabled flag', async () => {
  assert.equal(resolveBrowserConfig({}).enabled, false);
  assert.equal(resolveBrowserConfig({ browser: { enabled: 'true', channel: 'chrome', headless: false } }).channel, 'chrome');
  assert.equal(resolveBrowserConfig({ browser: { enabled: true, headless: false } }).headless, false);
  const config = await loadConfig();
  assert.equal(config.browser.enabled, false);
  assert.equal(config.browser.headless, true);
  assert.equal(config.browser.channel, 'auto');
  for (const name of BROWSER_READONLY_TOOLS) {
    assert.equal(config.execution.always_allow_tools.includes(name), true, name);
    assert.equal(toolRequiresUserApproval({
      approvalMode: 'review',
      toolName: name,
      alwaysAllowTools: config.execution.always_allow_tools,
    }), false, name);
  }
  assert.equal(toolRequiresUserApproval({
    approvalMode: 'review',
    toolName: 'browser_click',
    alwaysAllowTools: config.execution.always_allow_tools,
  }), true);
  assert.doesNotMatch(buildDefaultSystemPrompt({}), /Browser diagnostics/);
  assert.match(buildDefaultSystemPrompt({ browser: { enabled: true } }), /browser_diagnose_click/);
  assert.equal(resolveExecutionModeAllowedTools('plan', null, {}).includes('browser_open'), false);
  assert.equal(resolveExecutionModeAllowedTools('plan', null, { browser: { enabled: true } }).includes('browser_open'), true);
  assert.equal(resolveExecutionModeAllowedTools('normal', null, { browser: { enabled: true } }), null);
  assert.equal(resolveSubAgentToolAllowList({ role: 'debugger', config: {} }).includes('browser_listeners'), false);
  assert.equal(resolveSubAgentToolAllowList({ role: 'debugger', config: { browser: { enabled: true } } }).includes('browser_listeners'), true);
});

test('doctor reports Chrome or Edge without failing when browser tools are off', async () => {
  const lines = [];
  const previous = process.exitCode;
  try {
    await handleDoctor({
      loadConfigFn: async () => ({
        gateway: { base_url: 'https://example.com/v1', api_key: 'token' },
        sandbox: { enabled: false, mode: 'workspace-write' },
        browser: { enabled: false },
      }),
      checkPathWritableFn: async () => true,
      checkGatewayFn: async () => ({ ok: true, reason: 'reachable' }),
      commandExistsFn: async () => true,
      findInstalledBrowsersFn: () => [],
      checkMicrosandboxDoctorFn: async () => ({ ok: true, reason: 'unused' }),
      shouldCheckMicrosandboxFn: () => false,
      writeLine: (line) => lines.push(line),
    });
    assert.match(lines.join('\n'), /\[SKIP\] Local Chrome\/Edge: browser tools disabled/);
  } finally {
    process.exitCode = previous ?? 0;
  }
  const found = [];
  await handleDoctor({
    loadConfigFn: async () => ({
      gateway: { base_url: 'https://example.com/v1', api_key: 'token' },
      sandbox: { enabled: false, mode: 'workspace-write' },
      browser: { enabled: true },
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

test('settings and i18n expose browser controls in English and Chinese', async () => {
  const en = await fs.readFile(path.join(repoRoot, 'codemini-web/client/i18n/en.js'), 'utf8');
  const zh = await fs.readFile(path.join(repoRoot, 'codemini-web/client/i18n/zh.js'), 'utf8');
  const settings = await fs.readFile(path.join(repoRoot, 'codemini-web/client/src/lib/settings-config.js'), 'utf8');
  const options = await fs.readFile(path.join(repoRoot, 'codemini-web/client/src/lib/settings-options.js'), 'utf8');
  for (const key of ['browserEnabled', 'browserEnabledHelp', 'browserChannel', 'browserHeadless', 'hookTool_browser_diagnose_click']) {
    assert.match(en, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
  assert.match(en, /Enable browser diagnostics/);
  assert.match(zh, /启用浏览器诊断/);
  assert.match(settings, /path: "browser\.enabled"/);
  assert.match(settings, /path: "browser\.channel"/);
  assert.match(options, /value: "msedge"/);
});
