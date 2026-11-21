import test from 'node:test';
import assert from 'node:assert/strict';
import { crewCommandReviewNote, parseEvaluation } from '../src/core/command-evaluator.js';

test('crew worktree review note is only added for a worker worktree', () => {
  const worktree = '/repo/.codemini/crew/worktrees/wkr_ada/frontend';
  assert.match(crewCommandReviewNote(worktree), /Crew worker git worktree/);
  assert.match(crewCommandReviewNote(worktree), /main checkout stays unchanged/);
  assert.match(crewCommandReviewNote(worktree), /node_modules, \.venv, or target/);
  assert.equal(crewCommandReviewNote('/repo'), '');
  assert.equal(crewCommandReviewNote('/repo/.codemini/crew'), '');
});

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
