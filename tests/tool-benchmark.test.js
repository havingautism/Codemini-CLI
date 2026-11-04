import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { temporaryProject, createRecorder, summarizeUsage, compareReports } from '../scripts/bench-tools.mjs';
import { checkAcceptance } from '../scripts/benchmarks/tool-fixture.mjs';

test('benchmark independent acceptance rejects the unfixed starter project', async () => {
  const project = await temporaryProject();
  try {
    const result = await checkAcceptance(project.root, project.protectedHashes);
    assert.equal(result.passed, false);
    assert.equal(result.checks.independentBehavior, false);
    assert.equal(result.checks['unchanged:test/pricing.test.js'], true);
  } finally { await project.dispose(); }
});

test('benchmark CLI completes all platform profiles with independent project acceptance', async () => {
  const project = await temporaryProject();
  try {
    const env = { ...process.env };
    // Nested Node test commands must not inherit the parent test-runner IPC
    // protocol; the CLI normally starts outside node --test.
    delete env.NODE_TEST_CONTEXT;
    const output = path.join(project.root, 'benchmark-output');
    const cli = fileURLToPath(new URL('../scripts/bench-tools.mjs', import.meta.url));
    await promisify(execFile)(process.execPath, [cli, '--out', output, '--check'], { env, timeout: 45000, windowsHide: true });
    const report = JSON.parse(await fs.readFile(path.join(output, 'results.json'), 'utf8'));
    assert.equal(report.offline.length, 3);
    for (const result of report.offline) {
      assert.equal(result.passed, result.total, JSON.stringify(result.cases.filter((item) => !item.passed)));
      assert.ok(result.cases.some((item) => item.name === 'project-acceptance' && item.passed));
      assert.ok(result.calls.some((item) => item.name === 'tool_search'));
      assert.ok(result.calls.some((item) => item.name === 'Powershell' || item.name === 'Bash'));
      assert.ok(result.calls.filter((item) => item.name === 'tool_search').every((item) => !item.wire.includes('"schemas"')));
    }
  } finally { await project.dispose(); }
});

test('compact discovery keeps registry activation usable without schema echo', async () => {
  const project = await temporaryProject();
  const recorder = await createRecorder(project.root, 'win32');
  try {
    const result = await recorder.call('tool_search', { query: 'ast_query' });
    assert.ok(result.wire.length < 200);
    assert.ok(result.result.schemas.length === 1);
    const query = await recorder.call('ast_query', { path: 'src/pricing.js', query: '(function_declaration name: (identifier) @name)' });
    assert.ok(query.result.matches.length > 0);
  } finally { await recorder.dispose(); await project.dispose(); }
});

test('benchmark usage distinguishes absent reports and cached tokens', () => {
  assert.equal(summarizeUsage([]).promptTokens, null);
  assert.deepEqual(summarizeUsage([{ usage: { prompt_tokens: 200, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 100 } } }]),
    { reportedRequests: 1, promptTokens: 200, completionTokens: 30, cachedPromptTokens: 100 });
});

test('comparison retains a worse live sample instead of claiming savings', () => {
  const run = { offline: [{ platform: 'win32', passed: 14, total: 14, resultChars: 100, initialSchemaChars: 200 }],
    live: { model: 'test', passed: true, requests: [{}], toolCalls: 2, durationMs: 10 } };
  const after = structuredClone(run);
  after.live.toolCalls = 5;
  const text = compareReports(run, after);
  assert.match(text, /Tool calls \| 2 \| 5/);
  assert.match(text, /does \*\*not\*\* demonstrate lower end-to-end token usage/);
});
