import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHarnessArgs,
  parseScoreArgs,
  resolveSamplePath,
  selectInstanceByIndex
} from '../benchmark/swebench/score.mjs';

test('parseScoreArgs reads difficulty, index, and overrides', () => {
  const parsed = parseScoreArgs([
    '--difficulty',
    'high',
    '--index',
    '3',
    '--run-id',
    'high-3',
    '--max-workers',
    '2',
    '--python-bin',
    'python3',
    '--dataset-name',
    'princeton-nlp/SWE-bench_Verified',
    '--model',
    'gpt-test'
  ]);

  assert.deepEqual(parsed, {
    difficulty: 'high',
    index: 3,
    runId: 'high-3',
    maxWorkers: 2,
    pythonBin: 'python3',
    datasetName: 'princeton-nlp/SWE-bench_Verified',
    codeminiBin: 'node bin/coder.js',
    model: 'gpt-test',
    maxSteps: 12
  });
});

test('resolveSamplePath maps difficulty to local sample file', () => {
  assert.equal(resolveSamplePath('medium'), 'benchmark/swebench/data/verified-medium.sample.jsonl');
  assert.equal(resolveSamplePath('high'), 'benchmark/swebench/data/verified-high.sample.jsonl');
});

test('selectInstanceByIndex uses one-based indexing', () => {
  const instance = selectInstanceByIndex(
    [
      { instance_id: 'one' },
      { instance_id: 'two' },
      { instance_id: 'three' }
    ],
    2
  );

  assert.deepEqual(instance, { instance_id: 'two' });
});

test('buildHarnessArgs includes the selected instance id', () => {
  const args = buildHarnessArgs({
    datasetName: 'princeton-nlp/SWE-bench_Verified',
    predictionsPath: 'benchmark/swebench/runs/high-3/predictions.jsonl',
    instanceId: 'pydata__xarray-6992',
    maxWorkers: 1,
    runId: 'high-3'
  });

  assert.deepEqual(args, [
    '-m',
    'swebench.harness.run_evaluation',
    '--dataset_name',
    'princeton-nlp/SWE-bench_Verified',
    '--predictions_path',
    'benchmark/swebench/runs/high-3/predictions.jsonl',
    '--instance_ids',
    'pydata__xarray-6992',
    '--max_workers',
    '1',
    '--run_id',
    'high-3'
  ]);
});
