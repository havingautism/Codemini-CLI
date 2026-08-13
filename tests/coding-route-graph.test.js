import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCodingRouteDecisionBlock,
  evaluateCodingRouteGraph,
} from '../src/core/coding-route-graph.js';

test('coding route graph bypasses non-coding turns without invoking the judge', async () => {
  let calls = 0;
  const result = await evaluateCodingRouteGraph({
    executionMode: 'normal',
    text: 'remember this',
    judge: async () => {
      calls += 1;
      return {};
    },
  });

  assert.equal(result.active, false);
  assert.equal(calls, 0);
  assert.deepEqual(result.path, ['mode_gate', 'bypass_non_coding', 'complete']);
});

test('coding route graph uses semantic node decisions to gate capabilities', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: 'Refactor auth and remember that this project uses npm test',
    autoRoute: { complexity: 'complex' },
    memoryRoute: { leaf: 'save_memory', scope: 'project', kind: 'convention' },
    skillIndexPrompt: '# Indexed skills\n- /tdd - Test driven development',
    judge: async ({ systemPrompt, userPrompt }) => {
      assert.match(systemPrompt, /memory_gate/);
      assert.match(userPrompt, /\/tdd/);
      return JSON.stringify({
        memory: { leaf: 'save_memory', reason: 'explicit durable project rule' },
        skills: { selected_names: ['tdd'], reason: 'tdd is relevant' },
        subagents: {
          enabled: true,
          recommended_count: 2,
          focus: ['inspect architecture', 'verify tests'],
          reason: 'independent verification is useful',
        },
        todos: { required: true, reason: 'multi-file implementation and verification' },
      });
    },
  });

  assert.equal(result.active, true);
  assert.equal(result.source, 'llm');
  assert.equal(result.decisions.memory.allow_save_memory, true);
  assert.equal(result.decisions.memory.enforcement, 'hard_gate');
  assert.deepEqual(result.decisions.skills.selected_names, ['tdd']);
  assert.equal(result.decisions.skills.enforcement, 'injection');
  assert.equal(result.decisions.skills.inject_index, false);
  assert.equal(result.decisions.subagents.enabled, true);
  assert.equal(result.decisions.subagents.recommended_count, 2);
  assert.equal(result.decisions.subagents.enforcement, 'hard_gate');
  assert.deepEqual(result.decisions.subagents.focus, [
    'inspect architecture',
    'verify tests',
  ]);
  assert.equal(result.decisions.todos.required, true);
  assert.equal(result.decisions.todos.enforcement, 'directive');
  assert.deepEqual(result.path, [
    'mode_gate',
    'memory_gate',
    'skill_selection_gate',
    'subagent_gate',
    'todo_gate',
    'complete',
  ]);
  assert.match(buildCodingRouteDecisionBlock(result), /run_subagent enabled/);
  assert.match(buildCodingRouteDecisionBlock(result), /Delegation directive/);
  assert.match(buildCodingRouteDecisionBlock(result), /update_todos required/);
  assert.match(buildCodingRouteDecisionBlock(result), /Every subagent/);
});

test('coding route graph hard-blocks secret-like memory even when judge allows it', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: 'remember my token',
    memoryRoute: { leaf: 'save_memory' },
    sensitive: true,
    judge: async () => ({
      memory: { leaf: 'save_memory' },
      skills: { selected_names: [] },
      subagents: { enabled: false },
    }),
  });

  assert.equal(result.decisions.memory.leaf, 'ignore');
  assert.equal(result.decisions.memory.allow_save_memory, false);
});

test('coding route graph falls back when the semantic judge fails', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    autoRoute: { complexity: 'medium' },
    memoryRoute: { leaf: 'dream_inbox' },
    skillIndexPrompt: '# Indexed skills',
    judge: async () => {
      throw new Error('model unavailable');
    },
  });

  assert.equal(result.source, 'fallback');
  assert.equal(result.decisions.memory.allow_save_memory, false);
  assert.equal(result.decisions.skills.inject_index, true);
  assert.equal(result.decisions.subagents.enabled, true);
  assert.equal(result.decisions.todos.required, true);
});

test('advisory context pressure does not hard-force delegation', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    autoRoute: { complexity: 'simple' },
    contextUsage: {
      estimated_tokens: 18000,
      max_tokens: 128000,
      usage_pct: 14,
    },
  });

  assert.equal(result.source, 'fallback');
  assert.equal(result.decisions.subagents.enabled, false);
  assert.equal(result.decisions.subagents.recommended_count, 0);
});

test('hard context pressure overrides a conservative semantic judge', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    contextUsage: {
      estimated_tokens: 18000,
      max_tokens: 32000,
      usage_pct: 45,
    },
    judge: async () => ({
      memory: { leaf: 'ignore' },
      skills: { selected_names: [] },
      subagents: {
        enabled: false,
        recommended_count: 0,
        reason: 'task looks simple',
      },
    }),
  });

  assert.equal(result.source, 'llm');
  assert.equal(result.decisions.subagents.enabled, true);
  assert.equal(result.decisions.subagents.recommended_count, 2);
  assert.equal(
    result.decisions.subagents.reason,
    'hard context-isolation policy',
  );
});

test('project exploration and testing default to one subagent', async () => {
  for (const text of [
    'Inspect the repository architecture and dependencies',
    '运行测试并定位失败原因',
  ]) {
    const result = await evaluateCodingRouteGraph({
      executionMode: 'plan',
      text,
      autoRoute: { complexity: 'simple' },
      judge: async () => ({
        memory: { leaf: 'ignore' },
        skills: { selected_names: [] },
        subagents: { enabled: false, reason: 'looks simple' },
      }),
    });

    assert.equal(result.decisions.subagents.enabled, true);
    assert.equal(result.decisions.subagents.recommended_count, 1);
    assert.equal(
      result.decisions.subagents.reason,
      'project exploration or testing policy',
    );
  }
});

test('coding route graph rejects unlisted skill names and caps selection at three', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    skillIndexPrompt: [
      '# Indexed skills',
      '- /tdd - Test driven development',
      '- /diagnosing-bugs - Debug hard bugs',
      '- /code-review - Review changes',
      '- /codebase-design - Improve module interfaces',
    ].join('\n'),
    judge: async () => ({
      memory: { leaf: 'ignore' },
      skills: {
        selected_names: [
          '/tdd',
          'not-installed',
          'diagnosing-bugs',
          'code-review',
          'codebase-design',
        ],
      },
      subagents: { enabled: false },
    }),
  });

  assert.deepEqual(result.decisions.skills.selected_names, [
    'tdd',
    'diagnosing-bugs',
    'code-review',
  ]);
});

test('coding route judge prompt is positively biased toward useful skills and delegation', async () => {
  await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: 'Improve the routing module',
    skillIndexPrompt: '- /codebase-design - Improve module interfaces',
    judge: async ({ systemPrompt }) => {
      assert.match(systemPrompt, /positively prefer using installed expertise/);
      assert.match(systemPrompt, /Enable by default for medium\/complex tasks/);
      assert.match(systemPrompt, /Project exploration rule/);
      assert.match(systemPrompt, /Testing rule/);
      assert.match(systemPrompt, /Context-pressure rule/);
      assert.match(systemPrompt, /todo_gate/);
      assert.match(systemPrompt, /estimated_tokens >= 24000/);
      assert.match(systemPrompt, /recommended_count/);
      return {
        memory: { leaf: 'ignore' },
        skills: { selected_names: ['codebase-design'] },
        subagents: {
          enabled: true,
          recommended_count: 9,
          focus: ['inspect', 'test', 'review', 'ignored'],
        },
        todos: { required: true, reason: 'several implementation steps' },
      };
    },
  }).then((result) => {
    assert.equal(result.decisions.subagents.recommended_count, 3);
    assert.deepEqual(result.decisions.subagents.focus, ['inspect', 'test', 'review']);
    assert.equal(result.decisions.todos.required, true);
  });
});

test('todo gate keeps atomic coding work optional', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: 'Fix one typo',
    autoRoute: { complexity: 'simple' },
    judge: async () => ({
      memory: { leaf: 'ignore' },
      skills: { selected_names: [] },
      subagents: { enabled: false },
      todos: { required: false, reason: 'atomic edit' },
    }),
  });

  assert.equal(result.decisions.todos.required, false);
  assert.match(buildCodingRouteDecisionBlock(result), /update_todos optional/);
  assert.doesNotMatch(buildCodingRouteDecisionBlock(result), /Todo directive/);
});
