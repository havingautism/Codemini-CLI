import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCodingRouteDecisionBlock,
  evaluateCodingRouteGraph,
  isCodingRouteToolAllowed,
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
  assert.equal(result.decisions.subagents.enforcement, 'advisory');
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
  assert.match(buildCodingRouteDecisionBlock(result), /run_subagent recommended/);
  assert.match(buildCodingRouteDecisionBlock(result), /Delegation directive/);
  assert.match(buildCodingRouteDecisionBlock(result), /update_todos required/);
  assert.match(buildCodingRouteDecisionBlock(result), /Every subagent/);
});

test('semantic judge cannot upgrade an ignored turn into durable memory', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: 'Fix the typo',
    memoryRoute: { leaf: 'ignore' },
    judge: async () => ({
      memory: { leaf: 'save_memory', reason: 'might be useful later' },
      skills: { selected_names: [] },
      subagents: { enabled: false },
      todos: { required: false },
    }),
  });

  assert.equal(result.decisions.memory.leaf, 'ignore');
  assert.equal(result.decisions.memory.allow_save_memory, false);
});

test('semantic judge can enable delegation when it finds useful independent work', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: 'Fix the typo in README.md',
    autoRoute: { complexity: 'simple' },
    judge: async () => ({
      memory: { leaf: 'ignore' },
      skills: { selected_names: [] },
      subagents: { enabled: true, recommended_count: 3 },
      todos: { required: false },
    }),
  });

  assert.equal(result.decisions.subagents.enabled, true);
  assert.equal(result.decisions.subagents.recommended_count, 2);
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

test('hard context pressure uses window percentage and overrides a conservative judge', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    contextUsage: {
      estimated_tokens: 115000,
      max_tokens: 128000,
      usage_pct: 90,
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

test('generic exploration and testing words do not force delegation', async () => {
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

    assert.equal(result.decisions.subagents.enabled, false);
    assert.equal(result.decisions.subagents.recommended_count, 0);
    assert.equal(isCodingRouteToolAllowed(result, 'run_subagent'), true);
  }
});

test('explicit delegation intent enables one subagent case-insensitively', async () => {
  for (const text of ['Use a subagent to review this', '使用子代理检查这个改动']) {
    const result = await evaluateCodingRouteGraph({
      executionMode: 'plan',
      text,
      autoRoute: { complexity: 'simple' },
    });

    assert.equal(result.decisions.subagents.enabled, true);
    assert.equal(result.decisions.subagents.recommended_count, 1);
  }
});

test('explicit delegation opt-out overrides the semantic judge', async () => {
  for (const text of ['Do not use subagents', '不要使用子代理']) {
    const result = await evaluateCodingRouteGraph({
      executionMode: 'plan',
      text,
      autoRoute: { complexity: 'simple' },
      judge: async () => ({
        memory: { leaf: 'ignore' },
        skills: { selected_names: [] },
        subagents: { enabled: true, recommended_count: 2 },
        todos: { required: false },
      }),
    });

    assert.equal(result.decisions.subagents.enabled, false);
    assert.equal(result.decisions.subagents.recommended_count, 0);
    assert.equal(result.decisions.subagents.opted_out, true);
    assert.equal(isCodingRouteToolAllowed(result, 'run_subagent'), false);
  }
});

test('large model windows do not trigger isolation at low usage percentages', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: 'Fix one typo',
    autoRoute: { complexity: 'simple' },
    contextUsage: {
      estimated_tokens: 25000,
      max_tokens: 128000,
      usage_pct: 19.5,
    },
  });

  assert.equal(result.decisions.subagents.enabled, false);
  assert.equal(result.decisions.subagents.recommended_count, 0);
});

test('coding route graph rejects unlisted skill names and caps selection at two', async () => {
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
  ]);
});

test('coding route judge prompt encourages useful autonomous delegation', async () => {
  await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: 'Improve the routing module',
    skillIndexPrompt: '- /codebase-design - Improve module interfaces',
    judge: async ({ systemPrompt }) => {
      assert.match(systemPrompt, /Select none by default/);
      assert.match(systemPrompt, /Prefer delegation for non-trivial coding work/);
      assert.match(systemPrompt, /Decide from the task structure/);
      assert.match(systemPrompt, /Context-pressure rule/);
      assert.match(systemPrompt, /todo_gate/);
      assert.match(systemPrompt, /usage_pct >= 80/);
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
    assert.equal(result.decisions.subagents.recommended_count, 2);
    assert.deepEqual(result.decisions.subagents.focus, ['inspect', 'test']);
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
