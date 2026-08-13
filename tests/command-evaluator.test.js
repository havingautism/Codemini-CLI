import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEvaluation } from '../src/core/command-evaluator.js';

test('invalid LLM review responses retain a structured failure reason', () => {
  assert.deepEqual(parseEvaluation('not-json'), {
    risk: 'high',
    description: '',
    sideEffects: '',
    recommendation: 'deny',
    failed: true,
    failureReason: 'invalid_response',
  });
});
