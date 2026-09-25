import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldActivateHarness, shouldRollout } from '../src/core/harness/rollout.js';

test('enabled assistant runs rules without requiring shadow rollout', () => {
  assert.equal(shouldActivateHarness({ harness: { enabled: false, rollout: { enabled: false } } }), false);
  assert.equal(shouldActivateHarness({ harness: { enabled: true, provider: 'rules', rollout: { enabled: false, percentage: 0 } } }), true);
  assert.equal(shouldActivateHarness({ harness: { enabled: true, rollout: { enabled: true, percentage: 0 } } }), false);
  assert.equal(shouldActivateHarness({ harness: { enabled: true, rollout: { enabled: true, percentage: 100, risk_tiers: ['low'] } }, riskTier: 'low' }), true);
});

test('rollout defaults closed and supports deterministic 100 percent matching', () => {
  assert.equal(shouldRollout({ rollout: { enabled: false, percentage: 100 }, sessionId: 's' }), false);
  const config = { enabled: true, percentage: 100, risk_tiers: ['low'], salt: 'test' };
  assert.equal(shouldRollout({ rollout: config, sessionId: 's', projectDir: 'p', riskTier: 'low' }), true);
  assert.equal(shouldRollout({ rollout: config, sessionId: 's', projectDir: 'p', riskTier: 'high' }), false);
});

test('rollout bucket is stable across Windows path casing and separators', () => {
  const config = { enabled: true, percentage: 51, risk_tiers: ['low'], salt: 'stable-path' };
  const upper = shouldRollout({ rollout: config, sessionId: 'same-session', projectDir: 'C:\\Users\\Demo\\Project', riskTier: 'low' });
  const lower = shouldRollout({ rollout: config, sessionId: 'same-session', projectDir: 'c:/users/demo/project', riskTier: 'low' });
  assert.equal(upper, lower);
});
