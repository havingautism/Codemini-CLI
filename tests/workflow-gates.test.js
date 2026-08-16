import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCleanContextHandoff } from '../src/core/workflow-gates.js';

test('clean-context handoff omits raw executor transcripts', () => {
  const handoff = buildCleanContextHandoff([
    {
      role: 'coder',
      title: 'Implement comments',
      failed: false,
      artifactPaths: ['src/a.js'],
      output: [
        '## Findings',
        '- Added Comment model',
        '## Actions Taken',
        '- Edited src/a.js',
        '## Long Dump',
        '- secret executor chatter that supervisors should not need'
      ].join('\n')
    }
  ], 'reviewer');
  assert.match(handoff, /Clean-context handoff/);
  assert.match(handoff, /src\/a\.js/);
  assert.match(handoff, /Added Comment model/);
  assert.doesNotMatch(handoff, /secret executor chatter/);
});
