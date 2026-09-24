import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRollout } from '../src/core/harness/rollout.js';

test('rollout defaults closed and supports deterministic 100 percent matching', () => {
  assert.equal(shouldRollout({ rollout: { enabled: false, percentage: 100 }, sessionId: 's' }), false);
  const config = { enabled: true, percentage: 100, risk_tiers: ['low'], salt: 'test' };
  assert.equal(shouldRollout({ rollout: config, sessionId: 's', projectDir: 'p', riskTier: 'low' }), true);
  assert.equal(shouldRollout({ rollout: config, sessionId: 's', projectDir: 'p', riskTier: 'high' }), false);
});
