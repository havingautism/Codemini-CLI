import test from 'node:test';
import assert from 'node:assert/strict';
import { HARNESS_QUESTION_SET, createAbstainAnswer, createDecisionResponse } from '../src/core/harness/contracts.js';

test('harness contracts expose the fixed Phase 0 question set', () => {
  assert.deepEqual(HARNESS_QUESTION_SET.map((question) => question.id), [
    'next_action', 'action_risk', 'needs_review', 'task_complete'
  ]);
  assert.equal(createAbstainAnswer({ id: 'x', type: 'noul' }).abstain, true);
  assert.equal(createDecisionResponse({ latencyMs: -1 }).latencyMs, 0);
});
