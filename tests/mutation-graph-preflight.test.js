import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentLoop } from '../src/core/agent-loop.js';
import {
  createMutationGraphPreflight,
  PREFLIGHT_CODE,
} from '../src/core/mutation-graph-preflight.js';

function impactResult(files = ['src/a.js']) {
  const file = files[0];
  return {
    graph_version: 'graph-v1',
    stats: { displayed_nodes: 2, displayed_edges: 1 },
    nodes: [
      { id: `file:${file}`, type: 'file', label: 'a.js', file, summary: 'source file' },
      { id: 'file:src/b.js', type: 'file', label: 'b.js', file: 'src/b.js', summary: 'dependent file' },
    ],
    edges: [
      {
        source: 'file:src/b.js',
        target: `file:${file}`,
        relation: 'imports',
        confidence: 'EXTRACTED',
        evidence: { file: 'src/b.js', resolver: 'relative-import' },
      },
    ],
  };
}

test('mutation graph preflight gates once, then refreshes after a successful mutation', async () => {
  let queries = 0;
  const preflight = createMutationGraphPreflight({
    queryGraph: async ({ files }) => {
      queries += 1;
      return impactResult(files);
    },
  });

  const first = await preflight.inspect({
    toolName: 'edit',
    args: { path: 'src/a.js' },
    step: 1,
  });
  assert.equal(first.required, true);
  assert.equal(first.payload.code, PREFLIGHT_CODE);
  assert.equal(first.payload.mutation_applied, false);
  assert.match(first.content, /file:src\/b\.js --imports\/EXTRACTED--> file:src\/a\.js/);

  const duplicateInSameStep = await preflight.inspect({
    toolName: 'write',
    args: { path: 'src/a.js' },
    step: 1,
  });
  assert.equal(duplicateInSameStep.required, true);
  assert.equal(queries, 1);

  const retry = await preflight.inspect({
    toolName: 'edit',
    args: { path: 'src/a.js' },
    step: 2,
  });
  assert.equal(retry.required, false);

  preflight.record({
    toolName: 'edit',
    args: { path: 'src/a.js' },
    result: { ok: true },
    step: 2,
  });
  const afterMutation = await preflight.inspect({
    toolName: 'edit',
    args: { path: 'src/a.js' },
    step: 3,
  });
  assert.equal(afterMutation.required, true);
  assert.equal(queries, 2);
});

test('an explicit impact query satisfies the next mutation preflight', async () => {
  let queries = 0;
  const preflight = createMutationGraphPreflight({
    queryGraph: async () => {
      queries += 1;
      return impactResult();
    },
  });
  preflight.record({
    toolName: 'query_project_graph',
    args: { operation: 'impact', files: ['src/a.js'] },
    result: impactResult(),
    step: 1,
  });

  const result = await preflight.inspect({
    toolName: 'apply_patch',
    args: { patch_text: '*** Update File: src/a.js\n@@\n-old\n+new\n' },
    step: 2,
  });
  assert.equal(result.required, false);
  assert.equal(queries, 0);
});

test('CodeWiki comment mutations are covered by project graph preflight', async () => {
  const queriedFiles = [];
  const preflight = createMutationGraphPreflight({
    queryGraph: async ({ files }) => {
      queriedFiles.push(files);
      return impactResult(files);
    },
  });

  for (const [step, toolName] of ['add_code_comment', 'update_code_comment'].entries()) {
    const result = await preflight.inspect({
      toolName,
      args: { path: `src/comment-${step}.js`, line: 1, comment: 'why' },
      step: step + 1,
    });
    assert.equal(result.required, true);
  }

  assert.deepEqual(queriedFiles, [
    ['src/comment-0.js'],
    ['src/comment-1.js'],
  ]);
});

test('agent loop injects graph context before executing a write', async () => {
  let completionCall = 0;
  let writeCalls = 0;
  let graphCalls = 0;
  const observedMessages = [];
  const requestCompletion = async ({ messages }) => {
    observedMessages.push(structuredClone(messages));
    completionCall += 1;
    if (completionCall <= 2) {
      return {
        text: '',
        toolCalls: [{
          id: `write-${completionCall}`,
          name: 'write',
          arguments: JSON.stringify({ path: 'src/a.js', content: 'updated' }),
        }],
      };
    }
    return { text: 'done', toolCalls: [] };
  };

  const result = await runAgentLoop({
    systemPrompt: 'sys',
    userPrompt: 'update src/a.js',
    requestCompletion,
    toolHandlers: {
      query_project_graph: async ({ files }) => {
        graphCalls += 1;
        return impactResult(files);
      },
      write: async () => {
        writeCalls += 1;
        return { ok: true, path: 'src/a.js' };
      },
    },
    toolDefinitions: [],
    approvalMode: 'full_access',
    skipAnalysisNudge: true,
  });

  assert.equal(result.text, 'done');
  assert.equal(graphCalls, 1);
  assert.equal(writeCalls, 1);
  assert.match(JSON.stringify(observedMessages[1]), new RegExp(PREFLIGHT_CODE));
  assert.match(JSON.stringify(observedMessages[1]), /No file was changed/);
  assert.match(JSON.stringify(observedMessages[1]), /relative-import/);
  assert.equal(observedMessages[1].at(-1)?.tool_status, 'blocked');
});
