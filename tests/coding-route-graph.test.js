import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCodingRouteDecisionBlock,
  evaluateCodingRouteGraph,
  isCodingRouteToolAllowed,
  selectCodingRouteGates,
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

test('coding turns use a semantic judge even when the request looks simple', async () => {
  let calls = 0;
  await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: 'Fix one typo',
    judge: async () => {
      calls += 1;
      return { clarification: { mode: 'auto' }, skills: { selected_names: [] }, tasks: { required: false }, subagents: { enabled: false } };
    },
  });
  assert.equal(calls, 1);
});

test('coding route graph does not dump the skill index when the judge is skipped', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: 'Fix one typo',
    autoRoute: { complexity: 'simple' },
    skillIndexPrompt: '# Indexed skills\n- /tdd - Test driven development',
  });

  assert.equal(result.source, 'fallback');
  assert.equal(result.decisions.skills, undefined);
  assert.deepEqual(result.path, ['mode_gate', 'memory_gate', 'complete']);
});

test('coding route graph uses semantic node decisions to gate capabilities', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: 'Refactor auth and remember that this project uses npm test',
    autoRoute: { complexity: 'complex' },
    memoryRoute: { leaf: 'save_memory', scope: 'project', kind: 'convention' },
    skillIndexPrompt: '# Indexed skills\n- /tdd - Test driven development',
    judge: async ({ systemPrompt, userPrompt }) => {
      assert.match(systemPrompt, /six nodes/);
      assert.match(systemPrompt, /Judge difficulty from meaning/);
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
        tasks: { required: true, reason: 'multi-file implementation and verification' },
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
  assert.equal(result.decisions.tasks.required, true);
  assert.equal(result.decisions.tasks.enforcement, 'directive');
  assert.deepEqual(result.path, [
    'mode_gate',
    'skill_selection_gate',
    'task_gate',
    'subagent_gate',
    'memory_gate',
    'complete',
  ]);
  assert.match(buildCodingRouteDecisionBlock(result), /delegation=subagent; count=2/);
  assert.match(buildCodingRouteDecisionBlock(result), /tasks=required/);
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
      tasks: { required: false },
    }),
  });

  assert.equal(result.decisions.memory.leaf, 'ignore');
  assert.equal(result.decisions.memory.allow_save_memory, false);
});

test('semantic judge can enable delegation on a short request', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: 'Fix the typo in README.md',
    judge: async () => ({
      memory: { leaf: 'ignore' },
      skills: { selected_names: [] },
      subagents: { enabled: true, recommended_count: 3 },
      tasks: { required: false },
    }),
  });

  assert.equal(result.decisions.subagents.enabled, true);
  assert.equal(result.decisions.subagents.recommended_count, 2);
  assert.ok(result.path.includes('subagent_gate'));
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
  assert.equal(result.decisions.subagents, undefined);
  assert.equal(result.decisions.tasks, undefined);
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
  assert.equal(result.decisions.subagents, undefined);
});

test('hard context pressure uses window percentage and overrides a conservative judge', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: '修复这个问题并运行测试验证',
    contextUsage: {
      estimated_tokens: 115000,
      max_tokens: 128000,
      usage_pct: 90,
    },
    judge: async () => ({
      memory: { leaf: 'ignore' },
      skills: { selected_names: [] },
      tasks: { required: false },
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

    assert.equal(result.decisions.subagents, undefined);
    assert.equal(isCodingRouteToolAllowed(result, 'run_subagent'), false);
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
        tasks: { required: false },
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

  assert.equal(result.decisions.subagents, undefined);
});

test('coding route graph rejects unlisted skill names and caps selection at two', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    autoRoute: { complexity: 'medium' },
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
    autoRoute: { complexity: 'medium' },
    skillIndexPrompt: '- /codebase-design - Improve module interfaces',
    judge: async ({ systemPrompt }) => {
      assert.match(systemPrompt, /none by default/);
      assert.match(systemPrompt, /bounded independent work/);
      assert.match(systemPrompt, /2\+ meaningful steps/);
      assert.match(systemPrompt, />=80% context usage/);
      assert.match(systemPrompt, /recommended_count/);
      return {
        memory: { leaf: 'ignore' },
        skills: { selected_names: ['codebase-design'] },
        subagents: {
          enabled: true,
          recommended_count: 9,
          focus: ['inspect', 'test', 'review', 'ignored'],
        },
        tasks: {
          required: true,
          items: [
            { content: 'Inspect the implementation', activeForm: 'Inspecting the implementation' },
            { content: 'Verify focused tests', activeForm: 'Verifying focused tests' },
          ],
          reason: 'several implementation steps',
        },
      };
    },
  }).then((result) => {
    assert.equal(result.decisions.subagents.recommended_count, 2);
    assert.deepEqual(result.decisions.subagents.focus, ['inspect', 'test']);
    assert.equal(result.decisions.tasks.required, true);
    assert.deepEqual(result.decisions.tasks.items, [
      { content: 'Inspect the implementation', activeForm: 'Inspecting the implementation', status: 'pending' },
      { content: 'Verify focused tests', activeForm: 'Verifying focused tests', status: 'pending' },
    ]);
    assert.match(buildCodingRouteDecisionBlock(result), /suggested=Inspect the implementation/);
  });
});

test('task gate keeps atomic coding work optional', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: 'Fix one typo',
    autoRoute: { complexity: 'simple' },
  });

  assert.equal(result.decisions.tasks, undefined);
  assert.doesNotMatch(buildCodingRouteDecisionBlock(result), /Call tasks/);
});

test('semantic judge cannot downgrade the deterministic task floor', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: '1、实现来源原文展示\n2、运行测试验证',
    autoRoute: { complexity: 'simple' },
    judge: async () => ({
      memory: { leaf: 'ignore' },
      skills: { selected_names: [] },
      subagents: { enabled: false },
      tasks: { required: false, reason: 'judge underestimated it' },
    }),
  });

  assert.equal(result.decisions.tasks.required, true);
  assert.match(buildCodingRouteDecisionBlock(result), /tasks=required/);
});

test('edit continuation trace marks the task gate required without a step list', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: '把测试也补上再跑一遍',
    autoRoute: { complexity: 'simple' },
    toolTrace: { recentTools: ['read', 'edit', 'run'], editCount: 1 },
  });

  assert.equal(result.decisions.tasks.required, true);
});

test('two or more recent edits mark continuation even without continuation words', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: '再检查一下边界情况',
    autoRoute: { complexity: 'simple' },
    toolTrace: { recentTools: ['edit', 'write', 'run'], editCount: 2 },
  });

  assert.equal(result.decisions.tasks.required, true);
});

test('recent edits alone do not force tasks without continuation intent', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: '这个改动看起来不错',
    autoRoute: { complexity: 'simple' },
    toolTrace: { recentTools: ['edit'], editCount: 1 },
  });

  assert.equal(result.decisions.tasks, undefined);
});

test('semantic judge cannot discard the previous-turn continuation floor', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: '把测试也补上再跑一遍',
    autoRoute: { complexity: 'simple' },
    toolTrace: { recentTools: ['edit', 'run'], editCount: 1 },
    judge: async () => ({
      memory: { leaf: 'ignore' },
      skills: { selected_names: [] },
      subagents: { enabled: false },
      tasks: { required: false, reason: 'atomic follow-up' },
    }),
  });

  assert.equal(result.decisions.tasks.required, true);
});

test('clarification route never removes request_user_input', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: 'Fix the typo in README.md',
    autoRoute: { complexity: 'simple' },
  });

  assert.equal(result.decisions.clarification, undefined);
  assert.equal(isCodingRouteToolAllowed(result, 'request_user_input'), true);
});

test('clarification route recommends asking after inspection for material choices', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: '帮我重构这个模块，但不确定该不该动公共接口',
    autoRoute: { complexity: 'medium' },
    judge: async () => ({
      memory: { leaf: 'ignore' },
      skills: { selected_names: [] },
      subagents: { enabled: false },
      tasks: { required: false },
      clarification: { mode: 'ask', reason: 'public API change is a material choice' },
    }),
  });

  assert.equal(result.decisions.clarification.mode, 'ask');
  assert.equal(isCodingRouteToolAllowed(result, 'request_user_input'), true);
  const block = buildCodingRouteDecisionBlock(result);
  assert.match(block, /clarification=ask/);
  assert.match(block, /Inspect first/);
});

test('clarification route renders concise suggested questions', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: '接下来怎么安排，不确定先重构还是新增',
    autoRoute: { complexity: 'medium' },
    judge: async () => ({
      memory: { leaf: 'ignore' },
      skills: { selected_names: [] },
      subagents: { enabled: false },
      tasks: { required: false },
      clarification: {
        mode: 'ask',
        suggested_questions: ['目标是重构还是新增?', '是否需要兼容旧行为?'],
        reason: 'direction unclear',
      },
    }),
  });

  assert.equal(result.decisions.clarification.mode, 'ask');
  assert.equal(isCodingRouteToolAllowed(result, 'request_user_input'), true);
  assert.match(buildCodingRouteDecisionBlock(result), /suggested=目标是重构还是新增\?/);
});

test('clarification route defaults to auto when the judge does not ask', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: '不确定该不该动公共接口',
    judge: async () => ({
      clarification: { mode: 'auto' },
      skills: { selected_names: [] },
      tasks: { required: false },
      subagents: { enabled: false },
    }),
  });

  assert.equal(result.decisions.clarification, undefined);
  assert.equal(isCodingRouteToolAllowed(result, 'request_user_input'), true);
  assert.doesNotMatch(buildCodingRouteDecisionBlock(result), /clarification=ask/);
});

test('keyword-looking complexity does not open coding gates without a semantic decision', () => {
  const gates = selectCodingRouteGates({
    text: 'Add authentication workflow with session state across multiple files',
  });
  assert.equal(gates.clarification, false);
  assert.equal(gates.skills, false);
  assert.equal(gates.tasks, false);
  assert.equal(gates.subagents, false);
  assert.equal(gates.memory, true);
});

test('semantic judge opens clarification before skills when it asks', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: '帮我重构这个模块，但不确定该不该动公共接口',
    judge: async () => ({
      clarification: { mode: 'ask', reason: 'public API change is a material choice' },
      skills: { selected_names: ['tdd'] },
      tasks: { required: false },
      subagents: { enabled: false },
    }),
  });
  assert.ok(result.path.includes('clarification_gate'));
  assert.ok(result.path.includes('skill_selection_gate'));
  assert.ok(result.path.indexOf('clarification_gate') < result.path.indexOf('skill_selection_gate'));
});

test('parallel investigation intent recommends fork branches without delegation', async () => {
  for (const text of [
    '分别检查 frontend、backend 和 tests',
    'Inspect the frontend and backend in parallel',
  ]) {
    const result = await evaluateCodingRouteGraph({
      executionMode: 'plan',
      text,
      autoRoute: { complexity: 'medium' },
    });

    assert.equal(result.source, 'fallback');
    assert.equal(result.delegation_mode, 'parallel_task');
    assert.equal(result.decisions.forks.enabled, true);
    assert.equal(result.decisions.forks.recommended_count, 2);
    assert.equal(result.decisions.forks.enforcement, 'directive');
    assert.equal(result.decisions.subagents, undefined);
    assert.ok(result.path.includes('fork_gate'));
    assert.equal(isCodingRouteToolAllowed(result, 'run_subagent'), false);
    assert.match(buildCodingRouteDecisionBlock(result), /delegation=parallel_task; count=2/);
  }
});

test('semantic judge can recommend fork branches with a capped count and focus', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: 'Check the module layout',
    judge: async () => ({
      memory: { leaf: 'ignore' },
      skills: { selected_names: [] },
      tasks: { required: false },
      subagents: { enabled: false },
      forks: {
        enabled: true,
        recommended_count: 9,
        focus: ['frontend', 'backend', 'tests', 'ignored-extra'],
        reason: 'disjoint areas can share the same conversation state',
      },
    }),
  });

  assert.equal(result.source, 'llm');
  assert.equal(result.delegation_mode, 'parallel_task');
  assert.equal(result.decisions.forks.enabled, true);
  assert.equal(result.decisions.forks.recommended_count, 3);
  assert.deepEqual(result.decisions.forks.focus, ['frontend', 'backend', 'tests']);
  assert.equal(isCodingRouteToolAllowed(result, 'fork_task'), true);
  const block = buildCodingRouteDecisionBlock(result);
  assert.match(block, /delegation=parallel_task; count=3; focus=frontend \| backend \| tests/);
  assert.match(block, /Use fork_task.*do not call run_subagent/);
});

test('tower overlay keeps run_subagent even when the route prefers fork_task', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: 'Check the module layout',
    judge: async () => ({
      memory: { leaf: 'ignore' },
      skills: { selected_names: [] },
      tasks: { required: false },
      subagents: { enabled: false },
      forks: {
        enabled: true,
        recommended_count: 2,
        focus: ['frontend', 'backend'],
        reason: 'disjoint areas can share the same conversation state',
      },
    }),
  });

  assert.equal(result.delegation_mode, 'parallel_task');
  assert.equal(isCodingRouteToolAllowed(result, 'run_subagent'), false);
  assert.equal(isCodingRouteToolAllowed(result, 'run_subagent', { towerActive: true }), true);
  assert.equal(isCodingRouteToolAllowed(result, 'land_workers'), false);
  assert.equal(isCodingRouteToolAllowed(result, 'land_workers', { towerActive: true }), true);
  assert.equal(isCodingRouteToolAllowed(result, 'fork_task', { towerActive: true }), false);
  assert.equal(isCodingRouteToolAllowed(result, 'fork_task'), true);
  const towerForced = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: 'Check the module layout',
    towerActive: true,
    judge: async () => ({
      memory: { leaf: 'ignore' },
      skills: { selected_names: [] },
      tasks: { required: false },
      subagents: { enabled: false },
      forks: {
        enabled: true,
        recommended_count: 2,
        focus: ['frontend', 'backend'],
        reason: 'disjoint areas can share the same conversation state',
      },
    }),
  });
  assert.equal(towerForced.delegation_mode, 'subagent');
  const block = buildCodingRouteDecisionBlock(towerForced, { towerActive: true });
  assert.match(block, /Tower is on: every objective goes to run_subagent/);
  assert.match(block, /fork_task is not available/);
  assert.doesNotMatch(block, /do not call run_subagent/);
});

test('hard context pressure recommends subagents while fork_task remains available', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: '分别检查 frontend、backend 和 tests',
    contextUsage: {
      estimated_tokens: 115000,
      max_tokens: 128000,
      usage_pct: 90,
    },
    judge: async () => ({
      memory: { leaf: 'ignore' },
      skills: { selected_names: [] },
      tasks: { required: false },
      subagents: { enabled: false },
      forks: { enabled: true, recommended_count: 3, reason: 'parallel audit' },
    }),
  });

  // Branches replay the full prefix: at 90% usage the route prefers clean-context subagents.
  assert.equal(result.decisions.subagents.enabled, true);
  assert.equal(result.decisions.forks.enabled, false);
  assert.equal(result.decisions.forks.recommended_count, 0);
  assert.equal(result.delegation_mode, 'subagent');
  assert.equal(isCodingRouteToolAllowed(result, 'fork_task'), true);
  assert.match(buildCodingRouteDecisionBlock(result), /delegation=subagent; count=2/);
});

test('subagent opt-out does not disable an explicitly selected parallel task', async () => {
  for (const text of ['Do not use subagents', '不要使用子代理']) {
    const result = await evaluateCodingRouteGraph({
      executionMode: 'plan',
      text,
      autoRoute: { complexity: 'simple' },
      judge: async () => ({
        memory: { leaf: 'ignore' },
        skills: { selected_names: [] },
        tasks: { required: false },
        subagents: { enabled: true, recommended_count: 2 },
        forks: { enabled: true, recommended_count: 2 },
      }),
    });

    assert.equal(result.decisions.subagents.opted_out, true);
    assert.equal(result.decisions.forks.opted_out, false);
    assert.equal(result.decisions.forks.enabled, true);
    assert.equal(result.delegation_mode, 'parallel_task');
    assert.equal(isCodingRouteToolAllowed(result, 'run_subagent'), false);
    assert.equal(isCodingRouteToolAllowed(result, 'fork_task'), true);
  }
});

test('generic exploration words do not recommend forks but keep the tool available', async () => {
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

    assert.equal(result.decisions.forks, undefined);
    assert.equal(result.delegation_mode, 'direct');
    assert.equal(isCodingRouteToolAllowed(result, 'fork_task'), true);
  }
});

test('fork intent alone does not open the subagent gate', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: '分别检查 frontend、backend 和 tests',
    autoRoute: { complexity: 'medium' },
  });

  assert.equal(result.decisions.forks.enabled, true);
  assert.equal(result.decisions.subagents, undefined);
  assert.equal(result.delegation_mode, 'parallel_task');
  assert.equal(isCodingRouteToolAllowed(result, 'run_subagent'), false);
});

test('explicit subagent intent wins over generic parallel wording', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: '使用子代理分别检查 frontend、backend 和 tests',
  });

  assert.equal(result.delegation_mode, 'subagent');
  assert.equal(isCodingRouteToolAllowed(result, 'run_subagent'), true);
  assert.equal(isCodingRouteToolAllowed(result, 'fork_task'), true);
});

test('parallel task opt-out is independent from subagent opt-out', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: '不要使用并行任务，分别检查 frontend 和 backend',
    judge: async () => ({
      memory: { leaf: 'ignore' },
      skills: { selected_names: [] },
      tasks: { required: true },
      delegation: { mode: 'subagent', recommended_count: 1 },
    }),
  });

  assert.equal(result.delegation_mode, 'subagent');
  assert.equal(isCodingRouteToolAllowed(result, 'run_subagent'), true);
  assert.equal(isCodingRouteToolAllowed(result, 'fork_task'), true);
});

test('explicit parallel task intent overrides context-pressure preference', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: '使用并行任务分别检查 frontend 和 backend',
    contextUsage: { usage_pct: 90, max_tokens: 128000, estimated_tokens: 115200 },
  });

  assert.equal(result.delegation_mode, 'parallel_task');
  assert.equal(isCodingRouteToolAllowed(result, 'fork_task'), true);
  assert.equal(isCodingRouteToolAllowed(result, 'run_subagent'), false);
});

test('atomic work stays direct under hard context pressure', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: '修复 README 中一个错字',
    contextUsage: { usage_pct: 90, max_tokens: 128000, estimated_tokens: 115200 },
    judge: async () => ({
      memory: { leaf: 'ignore' },
      skills: { selected_names: [] },
      tasks: { required: false },
      delegation: { mode: 'direct' },
    }),
  });

  assert.equal(result.delegation_mode, 'direct');
  assert.equal(isCodingRouteToolAllowed(result, 'run_subagent'), false);
  assert.equal(isCodingRouteToolAllowed(result, 'fork_task'), true);
});

test('sequential wording does not select parallel tasks', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: '逐一检查 frontend、backend 和 tests',
  });

  assert.equal(result.delegation_mode, 'direct');
  assert.equal(isCodingRouteToolAllowed(result, 'fork_task'), true);
});

test('semantic judge can select a subagent DAG while fork_task remains available', async () => {
  const result = await evaluateCodingRouteGraph({
    executionMode: 'plan',
    text: '先检查配置，再根据检查结果修复并验证',
    judge: async () => ({
      memory: { leaf: 'ignore' },
      skills: { selected_names: [] },
      tasks: { required: true },
      delegation: {
        mode: 'subagent_dag',
        recommended_count: 2,
        focus: ['inspect', 'fix after inspect'],
      },
    }),
  });

  assert.equal(result.delegation_mode, 'subagent_dag');
  assert.equal(isCodingRouteToolAllowed(result, 'run_subagent'), true);
  assert.equal(isCodingRouteToolAllowed(result, 'fork_task'), true);
  assert.match(buildCodingRouteDecisionBlock(result), /Use run_subagent with task_id and depends_on/);
});
