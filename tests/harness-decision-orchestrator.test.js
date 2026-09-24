import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionOrchestrator } from '../src/core/harness/decision-orchestrator.js';

test('decision orchestrator normalizes task route and applies policy', async () => {
  const orchestrator = createDecisionOrchestrator({
    adapter: { async ask() { return { provider: 'jev', answers: [{ id: 'route', choice: 'proceed_fast', confidence: 0.9, probabilities: { proceed_fast: 0.9 } }] }; } },
  });
  const event = await orchestrator.decide({ kind: 'task_route', state: { riskTier: 'low' } });
  assert.equal(event.selected, 'proceed_fast');
  assert.equal(event.policy.choice, 'proceed_fast');
});

test('decision orchestrator refuses completion without verification', async () => {
  const orchestrator = createDecisionOrchestrator({
    adapter: { async ask() { return { provider: 'jev', answers: [{ id: 'completion_status', choice: 'complete', pTrue: 0.99 }] }; } },
  });
  const event = await orchestrator.decide({ kind: 'completion_review', state: { verificationPassed: false } });
  assert.equal(event.policy.choice, 'verify_more');
});

test('decision orchestrator uses provider probability for context retention', async () => {
  const orchestrator = createDecisionOrchestrator({
    adapter: { async ask() { return { provider: 'jev', answers: [{ id: 'keep_context', pTrue: 0.82 }] }; } },
    policy: { context_keep_probability: 0.7 },
  });
  const event = await orchestrator.decide({ kind: 'context_keep', state: { contextBlock: 'test output' }, questions: [{ id: 'keep_context', type: 'noul' }] });
  assert.equal(event.selected, true);
  assert.equal(event.probability, 0.82);
  assert.equal(event.policy.reason, 'context_relevant');
});
