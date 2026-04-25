import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPredictionRecord,
  extractPatch,
  parseRunnerArgs
} from '../benchmark/swebench/lib.mjs';

test('parseRunnerArgs reads paths, limits, and passthrough options', () => {
  const parsed = parseRunnerArgs([
    '--instances',
    'benchmark/swebench/data/verified-smoke.jsonl',
    '--output',
    'benchmark/swebench/runs/latest/predictions.jsonl',
    '--limit',
    '5',
    '--model',
    'gpt-test',
    '--max-steps',
    '12',
    '--codemini-bin',
    'node bin/coder.js',
    '--run-id',
    'verified-smoke'
  ]);

  assert.deepEqual(parsed, {
    instancesPath: 'benchmark/swebench/data/verified-smoke.jsonl',
    outputPath: 'benchmark/swebench/runs/latest/predictions.jsonl',
    transcriptDir: 'benchmark/swebench/runs/latest/transcripts',
    limit: 5,
    model: 'gpt-test',
    maxSteps: 12,
    codeminiBin: 'node bin/coder.js',
    runId: 'verified-smoke'
  });
});

test('extractPatch returns unified diff from mixed CLI output', () => {
  const output = [
    'Inspecting issue...',
    '',
    '```diff',
    'diff --git a/src/example.js b/src/example.js',
    'index 1111111..2222222 100644',
    '--- a/src/example.js',
    '+++ b/src/example.js',
    '@@ -1,3 +1,3 @@',
    "-export const value = 'before';",
    "+export const value = 'after';",
    '```',
    '',
    'Done.'
  ].join('\n');

  assert.equal(
    extractPatch(output),
    [
      'diff --git a/src/example.js b/src/example.js',
      'index 1111111..2222222 100644',
      '--- a/src/example.js',
      '+++ b/src/example.js',
      '@@ -1,3 +1,3 @@',
      "-export const value = 'before';",
      "+export const value = 'after';"
    ].join('\n')
  );
});

test('buildPredictionRecord trims patch and preserves required fields', () => {
  const record = buildPredictionRecord({
    instanceId: 'sympy__sympy-20590',
    modelName: 'codemini-cli',
    patch: '\n\ndiff --git a/a.py b/a.py\n--- a/a.py\n+++ b/a.py\n'
  });

  assert.deepEqual(record, {
    instance_id: 'sympy__sympy-20590',
    model_name_or_path: 'codemini-cli',
    model_patch: 'diff --git a/a.py b/a.py\n--- a/a.py\n+++ b/a.py'
  });
});
