import test from 'node:test';
import assert from 'node:assert/strict';
import { buildToolCandidates, filterCandidates } from '../src/core/harness/candidate-builder.js';
import { createDecisionRequest } from '../src/core/harness/decision-protocol.js';
import { resolveToolGuard } from '../src/core/harness/tool-guard.js';

test('decision protocol creates stable hashes and bounded candidates', () => {
  const request = createDecisionRequest({ kind: 'tool_route', state: { task: 'test' }, candidates: [{ id: 'run' }], questions: [] });
  assert.equal(request.kind, 'tool_route');
  assert.match(request.inputHash, /^sha256:/);
  assert.match(request.optionsHash, /^sha256:/);
});

test('candidate builder filters cooldown tools and keeps reliability', () => {
  const candidates = buildToolCandidates([
    { function: { name: 'run', description: 'run commands' } },
    { function: { name: 'rg', description: 'search files' } },
  ], { reliability: [{ tool_name: 'run', reliability: 0.32, failures: 4 }], cooldown: new Set(['rg']) });
  assert.deepEqual(candidates.map((item) => item.id), ['run']);
  assert.equal(filterCandidates(candidates, { minReliability: 0.5 }).length, 0);
});

test('tool guard never overrides a hard guard', () => {
  assert.deepEqual(resolveToolGuard({
    decision: { answers: [{ id: 'guard_action', choice: 'allow' }] },
    hardGuard: { allowed: false, requiresReview: false, reasons: ['blocked_path'] },
  }), { action: 'deny', reason: 'blocked_path' });
});
