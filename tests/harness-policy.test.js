import test from 'node:test';
import assert from 'node:assert/strict';
import { checkHardGuards } from '../src/core/harness/policy/hard-guards.js';
import { decideInfluencePolicy } from '../src/core/harness/policy/influence-policy.js';

test('hard guards escalate high-risk actions', () => {
  const guards = checkHardGuards({ state: { riskTier: 'critical' } });
  assert.equal(guards.allowed, false);
  assert.equal(guards.requiresReview, true);
});

test('influence policy refuses finish without deterministic verification', () => {
  const result = decideInfluencePolicy({
    belief: { TaskComplete: { true: 0.999 }, TestPass: { true: 0.999 } },
    guards: { allowed: true, requiresReview: false, reasons: [] },
    state: { verificationPassed: false },
  });
  assert.notEqual(result.action, 'finish');
});

test('external authority follows provider action after hard guards', () => {
  const result = decideInfluencePolicy({
    authorityMode: 'external_authority',
    decision: { answers: [{ id: 'next_action', choice: 'ask_user' }] },
    belief: { TaskComplete: { true: 0.2 }, TestPass: { true: 0.2 } },
    guards: { allowed: true, requiresReview: false },
  });
  assert.equal(result.action, 'ask_user');
  assert.equal(result.reason, 'external_authority');
});
