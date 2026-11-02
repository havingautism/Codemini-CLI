import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSkillCandidates, selectRouteFallback } from '../src/core/harness/skill-router.js';
import { resolveTaskRoute } from '../src/core/harness/task-router.js';
import { buildCompletionState, resolveCompletionReview } from '../src/core/harness/completion-review.js';
import { selectContextBlocks } from '../src/core/harness/context-selector.js';
import { compareCandidateOutcomes } from '../src/core/harness/counterfactual-eval.js';

test('skill routing filters disabled skills and falls back on low confidence', () => {
  const skills = buildSkillCandidates([{ name: 'debug', description: 'debug code' }, { name: 'deploy' }], { enabled: { deploy: false } });
  assert.deepEqual(skills.map((item) => item.id), ['debug']);
  assert.equal(selectRouteFallback([{ id: 'debug', probability: 0.52 }, { id: 'test', probability: 0.48 }]).choice, 'ask_user');
});

test('task route and completion review preserve hard safety conditions', () => {
  assert.equal(resolveTaskRoute({ choice: 'proceed_fast', probability: 0.99, margin: 0.5, riskTier: 'critical' }).choice, 'deep_review');
  assert.equal(resolveCompletionReview({ choice: 'complete', probability: 0.99, deterministicVerified: false }).choice, 'verify_more');
  assert.equal(buildCompletionState({ objective: 'x', criteria: ['test'] }).objective, 'x');
});

test('context selector always keeps required evidence and compares alternatives', () => {
  const selected = selectContextBlocks([{ id: 'policy', score: 0 }, { id: 'old', score: 0.1 }, { id: 'test', score: 0.9 }], { requiredIds: ['policy'] });
  assert.deepEqual(selected.kept.map((item) => item.id), ['policy', 'test']);
  assert.equal(compareCandidateOutcomes([{ candidate: 'run', success: true, latencyMs: 10 }, { candidate: 'rg', success: false, latencyMs: 2 }])[0].candidate, 'run');
});
