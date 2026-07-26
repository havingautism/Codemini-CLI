import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCleanContextHandoff } from '../src/core/workflow-gates.js';
import { createMutationGraphPreflight } from '../src/core/mutation-graph-preflight.js';

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

test('mutation graph preflight requires review even when impact graph is empty', async () => {
  const preflight = createMutationGraphPreflight({
    queryGraph: async () => ({ nodes: [], edges: [], graph_version: 'v-empty' })
  });
  const first = await preflight.inspect({
    toolName: 'edit',
    args: { path: 'src/a.js' },
    step: 1
  });
  assert.equal(first.required, true);
  assert.equal(first.empty_graph, true);
  assert.match(first.content, /No indexed dependents|verify callers manually/i);
});

test('mutation graph preflight blocks when graph query degrades', async () => {
  const preflight = createMutationGraphPreflight({
    queryGraph: async () => {
      throw new Error('graph unavailable');
    }
  });
  const first = await preflight.inspect({
    toolName: 'write',
    args: { path: 'src/a.js', content: 'x' },
    step: 1
  });
  assert.equal(first.required, true);
  assert.equal(first.degraded, true);
  assert.match(first.content, /impact lookup failed/i);
});
