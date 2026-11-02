import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeHarnessMetrics } from '../src/core/harness/metrics.js';

test('metrics summarizes decisions, errors, abstains, and actions', () => {
  const result = summarizeHarnessMetrics({
    episodes: [{ status: 'completed' }, { status: 'failed' }],
    events: [
      { type: 'harness:decision', payload: { policy: { action: 'escalate' }, decision: { errors: ['x'], answers: [{ abstain: true }] } } },
      { type: 'step:end', payload: {} },
    ],
  });
  assert.equal(result.episodes, 2);
  assert.equal(result.providerErrors, 1);
  assert.equal(result.abstains, 1);
  assert.equal(result.actionCounts.escalate, 1);
});
