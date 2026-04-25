import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRowsUrl,
  getDifficultyLabels,
  normalizeApiRows,
  parseImportArgs
} from '../benchmark/swebench/import-samples.mjs';

test('getDifficultyLabels maps medium and high to SWE-bench difficulty buckets', () => {
  assert.deepEqual(getDifficultyLabels('medium'), ['15 min - 1 hour']);
  assert.deepEqual(getDifficultyLabels('high'), ['1-4 hours', '>4 hours']);
});

test('parseImportArgs reads difficulty and output options', () => {
  const parsed = parseImportArgs([
    '--difficulty',
    'medium',
    '--difficulty',
    'high',
    '--per-difficulty',
    '4',
    '--output-dir',
    'benchmark/swebench/data',
    '--dataset',
    'SWE-bench/SWE-bench_Verified',
    '--split',
    'test'
  ]);

  assert.deepEqual(parsed, {
    difficulties: ['medium', 'high'],
    perDifficulty: 4,
    outputDir: 'benchmark/swebench/data',
    dataset: 'SWE-bench/SWE-bench_Verified',
    config: 'default',
    split: 'test'
  });
});

test('buildRowsUrl encodes filter queries for difficulty buckets', () => {
  const url = new URL(buildRowsUrl({
    dataset: 'SWE-bench/SWE-bench_Verified',
    config: 'default',
    split: 'test',
    difficultyLabel: '>4 hours',
    offset: 0,
    length: 25
  }));

  assert.equal(url.hostname, 'datasets-server.huggingface.co');
  assert.equal(url.pathname, '/filter');
  assert.equal(url.searchParams.get('dataset'), 'SWE-bench/SWE-bench_Verified');
  assert.equal(url.searchParams.get('where'), '"difficulty" = \'>4 hours\'');
});

test('normalizeApiRows keeps the fields used by the runner', () => {
  const rows = normalizeApiRows([
    {
      row: {
        instance_id: 'pydata__xarray-6992',
        repo: 'pydata/xarray',
        base_commit: 'abc123',
        problem_statement: 'Fix reset_index behavior',
        FAIL_TO_PASS: '["xarray/tests/test_dataset.py::test_reset_index"]',
        PASS_TO_PASS: '["xarray/tests/test_dataarray.py::test_reset_index"]',
        hints_text: 'look at reset_index',
        difficulty: '>4 hours'
      }
    }
  ]);

  assert.deepEqual(rows, [
    {
      instance_id: 'pydata__xarray-6992',
      repo: 'pydata/xarray',
      base_commit: 'abc123',
      problem_statement: 'Fix reset_index behavior',
      FAIL_TO_PASS: '["xarray/tests/test_dataset.py::test_reset_index"]',
      PASS_TO_PASS: '["xarray/tests/test_dataarray.py::test_reset_index"]',
      hints_text: 'look at reset_index',
      difficulty: '>4 hours'
    }
  ]);
});
