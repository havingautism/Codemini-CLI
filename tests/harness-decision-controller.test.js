import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionController } from '../src/core/harness/decision-controller.js';

test('disabled controller performs no work', async () => {
  let called = false;
  const controller = createDecisionController({ enabled: false, onDecision: () => { called = true; } });
  assert.equal(await controller.evaluate({ state: {} }), null);
  assert.equal(called, false);
});

test('enabled controller emits a shadow advisory event', async () => {
  let received = null;
  const controller = createDecisionController({ enabled: true, onDecision: (event) => { received = event; } });
  const event = await controller.evaluate({ episodeId: 'e1', step: 1, state: { toolError: true, retryBenefit: true } });
  assert.equal(event.mode, 'shadow');
  assert.equal(event.advisory.action, 'retry_once');
  assert.equal(received, event);
});

test('controller preserves separate shadow provider results', async () => {
  const adapter = {
    async askShadow() {
      return [
        { provider: 'jev', answers: [{ id: 'next_action', choice: 'continue' }] },
        { provider: 'laya', answers: [{ id: 'next_action', choice: 'finish' }] },
      ];
    }
  };
  const controller = createDecisionController({ enabled: true, provider: 'jev', adapter });
  const event = await controller.evaluate({ state: {} });
  assert.equal(event.decision.provider, 'jev');
  assert.equal(event.shadowDecisions.length, 2);
});

test('controller emits DBN belief and hard-guard policy', async () => {
  const controller = createDecisionController({ enabled: true, provider: 'rules' });
  const event = await controller.evaluate({ state: { riskTier: 'critical' } });
  assert.equal(event.policy.action, 'escalate');
  assert.equal(event.guards.requiresReview, true);
  assert.ok(event.belief.TaskComplete);
});
