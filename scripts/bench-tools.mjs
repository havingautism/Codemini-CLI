import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { getBuiltinTools } from '../src/core/tools.js';
import { createToolRuntime, buildInvalidToolArgumentsResult } from '../src/core/tool-runtime.js';
import { createToolResultStore } from '../src/core/tool-result-store.js';
import { runAgentLoop, formatToolResult } from '../src/core/agent-loop.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import { createFixture, checkAcceptance, taskPrompt } from './benchmarks/tool-fixture.mjs';

export async function temporaryProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-toolbench-'));
  const protectedHashes = await createFixture(root);
  return { root, protectedHashes, async dispose() {
    closeSqliteDatabasesForTests();
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('codemini-toolbench-')) throw new Error('Unsafe benchmark cleanup target');
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
  } };
}

export function benchmarkConfig(platform = process.platform) {
  return { memory: { enabled: false }, runtime: {}, policy: { allowed_paths: [], blocked_command_patterns: [], allow_dangerous_commands: false },
    shell: { default: process.platform === 'win32' ? 'powershell' : 'bash', timeout_ms: 30000 },
    sandbox: { enabled: false, mode: 'danger-full-access' }, tools: { max_parallel_calls: 4 } };
}

function boundedShell(bundle) {
  for (const name of ['Bash', 'Powershell']) {
    const original = bundle.handlers[name];
    if (!original) continue;
    bundle.handlers[name] = (args, context) => {
      if (!/^(?:npm test|node --test test\/\*\.test\.js)$/.test(String(args.command).trim())) throw new Error('Benchmark shell only permits npm test or node --test test/*.test.js');
      return original(args, context);
    };
  }
}

export async function createRecorder(root, platform, factory = getBuiltinTools) {
  const bundle = factory({ workspaceRoot: root, platform, config: benchmarkConfig(platform) });
  boundedShell(bundle);
  const runtime = createToolRuntime(bundle);
  const store = createToolResultStore();
  const calls = [];
  async function call(name, args) {
    const schemaChars = JSON.stringify(runtime.definitions()).length;
    const prepared = runtime.beginModelResponse([{ id: `bench-${calls.length}`, name, arguments: JSON.stringify(args) }]).calls[0];
    if (!prepared.isModelVisible) throw new Error(`Benchmark attempted an unloaded tool: ${name}`);
    const started = performance.now();
    let result;
    let thrown = false;
    try {
      result = prepared.args?._invalid_schema || prepared.args?._invalid_json
        ? buildInvalidToolArgumentsResult(name, prepared.args)
        : await runtime.execute(name, prepared.args);
    } catch (error) { thrown = true; result = { error: error.message, code: error.code }; }
    let formatted = formatToolResult(result, name, prepared.args, runtime, 12000);
    if (thrown && !/^error:/im.test(formatted)) formatted = `error: ${result.error}\n\n${formatted}`;
    const wire = result?.bounded_read ? formatted : await store.storeResultIfNeeded(`bench-${calls.length}`, formatted, result);
    if (name === 'tool_search' && result.schemas) runtime.activateSchemas(result.schemas);
    calls.push({ name, args, argumentChars: JSON.stringify(args).length, resultChars: wire.length, schemaChars,
      error: Boolean(result.error || result.ok === false), errorMessage: result.error, durationMs: Math.round(performance.now() - started), wire });
    return { result, wire };
  }
  return { bundle, runtime, calls, call, async load(name) {
    if (!runtime.definitions().some((d) => d.function.name === name)) await call('tool_search', { query: name });
  }, async dispose() { await bundle.dispose(); await store.clear(); } };
}

export async function runOffline(platform, factory = getBuiltinTools) {
  const project = await temporaryProject();
  const recorder = await createRecorder(project.root, platform, factory);
  const cases = [];
  const check = (name, passed, detail = '') => cases.push({ name, passed: Boolean(passed), detail });
  try {
    await recorder.load('glob');
    const discovered = await recorder.call('glob', { pattern: 'src/*.js' });
    check('file-discovery', discovered.result.matches?.includes('src/pricing.js'));
    const search = await recorder.call('search_code', { query: 'BENCH_NEEDLE', path: 'src', mode: 'text', max_results: 3 });
    check('search-truncation-visible', search.result.truncated && /truncat|narrow|more match/i.test(search.wire), 'A limited result must never appear exhaustive.');
    await recorder.load('grep');
    const grep = await recorder.call('grep', { pattern: 'BENCH_NEEDLE', path: 'src', max_results: 3 });
    check('grep-truncation-visible', grep.result.truncated && /truncat|narrow|more match/i.test(grep.wire));
    check('grep-small-budget-respected', grep.result.matches?.length === 3);
    const directory = await recorder.call('glob', { pattern: '*.txt', path: 'catalog', max_results: 3 });
    check('glob-truncation-visible', directory.result.truncated && /truncat|narrow|more file/i.test(directory.wire));
    check('glob-small-budget-respected', directory.result.matches?.length === 3);
    check('glob-workspace-relative-paths', directory.result.matches?.every((file) => file.startsWith('catalog/')));
    const read = await recorder.call('read', platform === 'win32' ? { path: 'src/pricing.js' } : { file_path: 'src/pricing.js' });
    check('complete-source-window', /export function quoteOrder/.test(read.wire) && !/omitted|persisted-output/.test(read.wire));
    await recorder.load('list');
    const listing = await recorder.call('list', { path: 'src' });
    check('directory-listing', listing.wire.includes('pricing.js') && listing.wire.includes('quantity.js'));
    const loading = await recorder.call('tool_search', { query: 'ast_query' });
    check('discovery-no-schema-echo', recorder.runtime.definitions().some((d) => d.function.name === 'ast_query') && !/"schemas"|"parameters"/.test(loading.wire));
    const wrong = await recorder.call('edit', platform === 'win32'
      ? { path: 'src/pricing.js', old_text: 'not present', new_text: 'replacement' }
      : { file_path: 'src/pricing.js', old_string: 'not present', new_string: 'replacement' });
    check('edit-miss-recoverable', wrong.result.error && /read|context/i.test(wrong.wire));
    check('failed-edit-not-success', wrong.result.error && !/\nedited\s*$/.test(wrong.wire));
    await recorder.call('read', platform === 'win32' ? { path: 'src/quantity.js' } : { file_path: 'src/quantity.js' });
    const edit = (file, before, after) => recorder.call('edit', platform === 'win32'
      ? { path: file, old_text: before, new_text: after }
      : { file_path: file, old_string: before, new_string: after });
    await edit('src/quantity.js', 'Number.isFinite(qty)', 'Number.isSafeInteger(qty)');
    await edit('src/pricing.js', 'subtotal * (1 + taxRate) - (member ? 10 : 0)', 'subtotal * (member ? 0.9 : 1) * (1 + taxRate)');
    await recorder.call('read', platform === 'win32' ? { path: 'README.md' } : { file_path: 'README.md' });
    await edit('README.md', 'Pricing rules need documenting.', 'Members receive a 10% discount before tax.');
    const command = recorder.runtime.definitions().find((d) => ['Bash', 'Powershell'].includes(d.function.name))?.function.name;
    const tested = await recorder.call(command, { command: 'node --test test/*.test.js' });
    check('shell-test-outcome', tested.result.code === 0 && /pass|passed/i.test(tested.wire), tested.result.error || '');
    const acceptance = await checkAcceptance(project.root, project.protectedHashes);
    check('project-acceptance', acceptance.passed, JSON.stringify(acceptance.checks));
    return { mode: 'offline-scripted', platform, nativeHost: process.platform, cases,
      passed: cases.filter((c) => c.passed).length, total: cases.length,
      toolCalls: recorder.calls.length, resultChars: recorder.calls.reduce((sum, c) => sum + c.resultChars, 0),
      initialSchemaChars: JSON.stringify(recorder.bundle.definitions).length, calls: recorder.calls };
  } finally { await recorder.dispose(); await project.dispose(); }
}

export async function runLive(factory = getBuiltinTools) {
  const { loadConfig } = await import('../src/core/config-store.js');
  const { resolveConfiguredReasoningEffort } = await import('../src/core/provider/reasoning-effort.js');
  const { buildDefaultSystemPrompt } = await import('../src/core/default-system-prompt.js');
  const saved = await loadConfig();
  // Use the configured provider transport, with usage recorded only in this
  // benchmark report rather than the user's global usage database.
  const { createChatCompletionStream } = await import(saved.sdk?.provider === 'anthropic'
    ? '../src/core/provider/anthropic.js' : '../src/core/provider/openai-compatible.js');
  const project = await temporaryProject();
  const platform = process.platform;
  const config = benchmarkConfig(platform);
  const bundle = factory({ workspaceRoot: project.root, platform, config });
  const allowed = new Set(['read', 'search_code', 'edit', 'write', 'apply_patch', 'begin_write', 'write_chunk', 'commit_write', 'abort_write',
    'Powershell', 'Bash', 'tool_search', 'tasks', 'glob', 'grep', 'list', 'ast_query', 'read_ast_node', 'query_project_index', 'query_project_graph']);
  bundle.definitions = bundle.definitions.filter((definition) => allowed.has(definition.function.name));
  bundle.deferredDefinitions = Object.fromEntries(Object.entries(bundle.deferredDefinitions).filter(([name]) => allowed.has(name)));
  // tool_search closes over its original catalog. Constrain returned activation
  // to the same file-tool subset; no personal skills, memory or web tools run.
  const searchTools = bundle.handlers.tool_search;
  bundle.handlers.tool_search = (args) => {
    if (args.query !== 'all' && !allowed.has(args.query)) return { error: 'This synthetic benchmark only exposes project file tools.' };
    const result = searchTools(args);
    if (result.schemas) result.schemas = result.schemas.filter((definition) => allowed.has(definition.function.name));
    if (result.loaded) result.loaded = result.loaded.filter((name) => allowed.has(name));
    return result;
  };
  boundedShell(bundle);
  const requests = [];
  const events = [];
  const started = performance.now();
  const timer = AbortSignal.timeout(180000);
  let result;
  let failure;
  try {
    result = await runAgentLoop({ workspaceRoot: project.root, systemPrompt: buildDefaultSystemPrompt(config, { workspaceRoot: project.root, platform }),
      userPrompt: taskPrompt, model: saved.model.name, config, maxSteps: 16, signal: timer,
      approvalMode: 'full_access', skipAnalysisNudge: true, toolDefinitions: bundle.definitions,
      toolHandlers: bundle.handlers, toolFormatters: bundle.formatters, deferredDefinitions: bundle.deferredDefinitions,
      onEvent: (event) => { if (['tool:start', 'tool:end', 'tool:error'].includes(event.type)) events.push(event); },
      requestCompletion: async ({ messages, tools, model }) => {
        const request = { number: requests.length + 1, messageChars: JSON.stringify(messages).length, schemaChars: JSON.stringify(tools).length };
        requests.push(request);
        const completion = await createChatCompletionStream({ sdkProvider: saved.sdk?.provider, baseUrl: saved.gateway.base_url, apiKey: saved.gateway.api_key,
          model, messages, tools, reasoningEffort: resolveConfiguredReasoningEffort({ enabled: saved.model.reasoning_enabled, effort: saved.model.reasoning_effort }),
          maxTokens: Math.min(Number(saved.model.max_output_tokens) || 8192, 8192), maxRetries: 0, timeoutMs: 60000, signal: timer });
        request.usage = completion.usage;
        return completion;
      },
    });
  } catch (error) {
    const message = saved.gateway?.api_key ? String(error.message).split(saved.gateway.api_key).join('[REDACTED]') : String(error.message);
    failure = { name: error.name, code: error.code || error.cause?.code, message: message.slice(0, 500) };
  }
  try {
    const acceptance = await checkAcceptance(project.root, project.protectedHashes);
    return { mode: 'live-model', model: saved.model.name, sdkProvider: saved.sdk?.provider, platform, nativeHost: process.platform,
      passed: !failure && acceptance.passed, acceptance, failure, durationMs: Math.round(performance.now() - started), requests,
      toolCalls: events.filter((e) => e.type === 'tool:start').length, events,
      tokenUsage: summarizeUsage(requests),
      transcript: result?.messages, finalText: result?.text,
      note: 'One synthetic task, not a statistical model success-rate estimate. No real workspace or user documents were sent.' };
  } finally { await bundle.dispose(); await project.dispose(); }
}

export function summarizeUsage(requests = []) {
  const usages = requests.map((request) => request.usage).filter(Boolean);
  if (usages.length === 0) return { reportedRequests: 0, promptTokens: null, completionTokens: null, cachedPromptTokens: null };
  const sum = (pick) => usages.reduce((total, usage) => total + (Number(pick(usage)) || 0), 0);
  return { reportedRequests: usages.length, promptTokens: sum((u) => u.prompt_tokens ?? u.input_tokens),
    completionTokens: sum((u) => u.completion_tokens ?? u.output_tokens),
    cachedPromptTokens: sum((u) => u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? u.cache_read_input_tokens) };
}

export function compareReports(before, after) {
  const rows = after.offline.map((next) => {
    const prior = before.offline.find((item) => item.platform === next.platform);
    return `| ${next.platform} | ${prior.passed}/${prior.total} → ${next.passed}/${next.total} | ${prior.resultChars} → ${next.resultChars} | ${prior.initialSchemaChars} → ${next.initialSchemaChars} |`;
  });
  let text = `# Tool benchmark comparison\n\nSame synthetic project and scripted tool trace; platform profiles execute on the native test host. Checks measure contracts, not model success rates.\n\n| Profile | Contract checks | Tool-result chars | Initial schema chars |\n|---|---:|---:|---:|\n${rows.join('\n')}\n`;
  if (before.live && after.live) {
    const a = before.live, b = after.live;
    const x = a.tokenUsage || summarizeUsage(a.requests), y = b.tokenUsage || summarizeUsage(b.requests);
    text += `\n## Real model sample\n\nModel: ${b.model}. One run per variant; both used a fresh project, the same task, and independent acceptance.\n\n| Metric | Before | After |\n|---|---:|---:|\n| Acceptance | ${a.passed} | ${b.passed} |\n| Provider requests | ${a.requests.length} | ${b.requests.length} |\n| Tool calls | ${a.toolCalls} | ${b.toolCalls} |\n| Reported prompt tokens (including cache) | ${x.promptTokens} | ${y.promptTokens} |\n| Reported cached prompt tokens | ${x.cachedPromptTokens} | ${y.cachedPromptTokens} |\n| Reported completion tokens | ${x.completionTokens} | ${y.completionTokens} |\n| Wall time, ms | ${a.durationMs} | ${b.durationMs} |\n\nThis sample does **not** demonstrate lower end-to-end token usage: model action choices differed, and the second run used more calls. Cache state and nondeterministic generation also differ. The repeatable evidence is the fixed-trace contract improvements and result-size measurements. No monetary-cost estimate or statistical model success rate is claimed.\n`;
  }
  return text;
}

export function markdownReport(report) {
  const rows = report.offline.map((r) => `| ${r.platform} | ${r.passed}/${r.total} | ${r.toolCalls} | ${r.initialSchemaChars} | ${r.resultChars} |`);
  return `# Tool benchmark\n\nGenerated: ${report.generatedAt}\n\nOffline traces call the real registry, normalization, handlers and formatters with scripted actions. These are tool-contract checks, not model success rates. Platform branches run on ${process.platform}; OS/VM sandbox launch is not measured.\n\n| Platform profile | Checks | Calls | Initial schema chars | Tool result chars |\n|---|---:|---:|---:|---:|\n${rows.join('\n')}\n\n` +
    report.offline.map((r) => `## ${r.platform} findings\n\n${r.cases.map((c) => `- ${c.passed ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ': ' + c.detail : ''}`).join('\n')}\n`).join('\n') +
    (report.live ? `\n## Live model\n\nModel: ${report.live.model}. Independent acceptance: ${report.live.passed ? 'PASS' : 'FAIL'}. Requests: ${report.live.requests.length}. Tool calls: ${report.live.toolCalls}. Duration: ${report.live.durationMs} ms.\n\n${report.live.failure ? JSON.stringify(report.live.failure) : JSON.stringify(report.live.acceptance)}\n\nUsage comes from the provider when reported; character counts are not billed tokens. One run cannot establish a model success rate.\n` : '');
}

async function main() {
  const args = process.argv.slice(2);
  const output = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : '.scratch/tool-benchmark/current');
  await fs.mkdir(output, { recursive: true });
  let factory = getBuiltinTools;
  if (args.includes('--tools-module')) factory = (await import(pathToFileURL(path.resolve(args[args.indexOf('--tools-module') + 1])).href)).getBuiltinTools;
  const report = { fixtureVersion: 'desk-orders-v1', generatedAt: new Date().toISOString(), offline: [] };
  for (const platform of ['win32', 'linux', 'darwin']) {
    report.offline.push(await runOffline(platform, factory));
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
  }
  if (args.includes('--live')) {
    report.live = await runLive(factory);
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
  }
  await fs.writeFile(path.join(output, 'REPORT.md'), markdownReport(report));
  if (args.includes('--compare')) {
    const before = JSON.parse(await fs.readFile(path.resolve(args[args.indexOf('--compare') + 1]), 'utf8'));
    await fs.writeFile(path.join(output, 'COMPARISON.md'), compareReports(before, report));
  }
  if (args.includes('--check') && (report.offline.some((result) => result.passed !== result.total) || (report.live && !report.live.passed))) process.exitCode = 1;
  console.log(JSON.stringify({ output, offline: report.offline.map(({ platform, passed, total }) => ({ platform, passed, total })),
    live: report.live ? { passed: report.live.passed, model: report.live.model, requests: report.live.requests.length, error: report.live.failure } : undefined }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
