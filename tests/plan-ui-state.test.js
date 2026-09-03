import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPlanEventToMessage,
  applyStreamEventToPlanRun,
  findPlanStepMessageId,
  findActivePlanParentMessage,
  isLegacyFinalPlanStep,
  planPhaseTitle,
  planRunFromTranscript,
  settleCompletedPlanToolCards,
  settleRunningCreatePlanCards,
  shouldNestStreamEventInPlan,
  stripDelegationTaskPrefix,
  updatePlanOverviewStepStatus,
} from '../codemini-web/client/src/lib/plan-ui-state.js';

test('delegation task labels omit generated branch prefixes', () => {
  assert.equal(stripDelegationTaskPrefix('子代理 B：检查文件'), '检查文件');
  assert.equal(stripDelegationTaskPrefix('分支-a: 检查缓存'), '检查缓存');
  assert.equal(stripDelegationTaskPrefix('Parallel task 2: run tests'), 'run tests');
  assert.equal(stripDelegationTaskPrefix('分支策略：比较实现'), '分支策略：比较实现');
});

test('planPhaseTitle maps phases', () => {
  assert.equal(planPhaseTitle('planning'), 'Subagent · 准备');
  assert.equal(planPhaseTitle('executing'), 'Subagent · 运行中');
  assert.equal(planPhaseTitle('completed'), 'Subagent · 完成');
  assert.equal(planPhaseTitle('failed'), 'Subagent · 失败');
  assert.equal(planPhaseTitle('aborted'), 'Subagent · 已中止');
});

test('applyPlanEventToMessage keeps plan progress on create_plan card', () => {
  let message = {
    id: 'parent',
    role: 'general',
    segments: [
      {
        type: 'tools',
        cards: [
          {
            id: 'call-1',
            name: 'create_plan',
            status: 'running',
            arguments: { goal: 'Add three features' },
          },
        ],
      },
    ],
  };

  message = applyPlanEventToMessage(message, {
    type: 'plan:steps',
    goal: 'Add three features',
    steps: [
      { index: 1, role: 'explorer', title: 'Inspect' },
      { index: 2, role: 'summarizer', title: 'Synthesize' },
    ],
  });
  assert.equal(message.segments[0].cards[0].planRun.phase, 'executing');
  assert.equal(message.segments[0].cards[0].displayName, 'Subagent · 运行中');

  message = applyPlanEventToMessage(message, {
    type: 'plan:step_start',
    step: 1,
    role: 'explorer',
    title: 'Inspect',
  });
  assert.equal(message.segments[0].cards[0].planRun.steps[0].status, 'running');

  message = applyPlanEventToMessage(message, {
    type: 'plan:step_done',
    step: 1,
    role: 'explorer',
    title: 'Inspect',
    status: 'done',
    output: 'Handoff done',
    sdkProvider: 'openai-compatible',
    model: 'lite-model',
    usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100, requests: 1 },
    usageScope: 'subagent',
  });
  message = applyPlanEventToMessage(message, {
    type: 'plan:step_done',
    step: 2,
    role: 'summarizer',
    title: 'Synthesize',
    status: 'done',
    output: 'Internal summary',
  });

  const card = message.segments[0].cards[0];
  assert.equal(card.status, 'done');
  assert.equal(card.planRun.phase, 'completed');
  assert.equal(card.displayName, 'Subagent · 完成');
  assert.equal(card.planRun.steps[0].usage.totalTokens, 100);
  assert.equal(card.planRun.steps[0].sdkProvider, 'openai-compatible');
  assert.equal(card.planRun.steps[0].model, 'lite-model');
  assert.equal(card.planRun.steps[1].segments[0].type, 'text');
  // Parent message usage stays unset; subagent tokens live on the step only.
  assert.equal(message.usage, undefined);
});

test('planRunFromTranscript builds completed card state', () => {
  const planRun = planRunFromTranscript('Goal', [
    { step: 1, role: 'coder', title: 'Edit', status: 'done', segments: [] },
  ]);
  assert.equal(planRun.goal, 'Goal');
  assert.equal(planRun.steps[0].role, 'coder');
});

test('findPlanStepMessageId scopes lookup to the current plan overview', () => {
  const messages = [
    {
      id: 'overview-1',
      role: 'plan-overview',
      planOverview: { steps: [{ status: 'done' }] },
    },
    {
      id: 'plan1-step-5',
      planStep: { step: 5, role: 'summarizer', status: 'done' },
    },
    {
      id: 'overview-2',
      role: 'plan-overview',
      planOverview: { steps: [{ status: 'running' }] },
    },
    {
      id: 'plan2-step-5',
      planStep: { step: 5, role: 'summarizer', status: 'running' },
    },
  ];

  assert.equal(findPlanStepMessageId(messages, 'overview-2', 5), 'plan2-step-5');
  assert.equal(findPlanStepMessageId(messages, 'overview-1', 5), 'plan1-step-5');
});

test('settleRunningCreatePlanCards stops running steps and nested tools', () => {
  const message = {
    id: 'parent',
    role: 'general',
    segments: [
      {
        type: 'tools',
        cards: [
          {
            id: 'c1',
            name: 'create_plan',
            status: 'running',
            planRun: {
              phase: 'executing',
              steps: [
                {
                  status: 'running',
                  segments: [
                    {
                      type: 'tools',
                      cards: [{ id: 't1', name: 'read', status: 'running' }],
                    },
                  ],
                },
                { status: 'pending', segments: [] },
              ],
            },
          },
        ],
      },
    ],
  };
  const next = settleRunningCreatePlanCards(message, { reason: 'aborted' });
  const card = next.segments[0].cards[0];
  assert.equal(card.status, 'done');
  assert.equal(card.planRun.phase, 'aborted');
  assert.equal(card.planRun.steps[0].status, 'failed');
  assert.equal(card.planRun.steps[1].status, 'failed');
  assert.equal(card.planRun.steps[0].segments[0].cards[0].status, 'error');
});

test('settleCompletedPlanToolCards repairs a duplicated sibling tool from an old snapshot', () => {
  const messages = [
    {
      id: 'parent',
      role: 'general',
      isComplete: true,
      segments: [
        {
          type: 'tools',
          cards: [
            {
              id: 'subagent',
              name: 'run_subagent',
              status: 'done',
              planRun: {
                phase: 'completed',
                steps: [
                  {
                    status: 'done',
                    segments: [
                      {
                        type: 'tools',
                        cards: [{ id: 'list', name: 'list', status: 'done', result: 'files' }],
                      },
                    ],
                  },
                ],
              },
            },
            { id: 'list', name: 'list', status: 'running' },
          ],
        },
      ],
    },
  ];

  const [message] = settleCompletedPlanToolCards(messages);
  const [subagent, list] = message.segments[0].cards;
  assert.equal(list.status, 'done');
  assert.equal(list.result, 'files');
  assert.deepEqual(subagent.planRun.steps[0].segments, []);
});

test('isLegacyFinalPlanStep ignores one-step run_subagent completion', () => {
  assert.equal(
    isLegacyFinalPlanStep({ type: 'plan:step_done', step: 1, total: 1, role: 'Kai' }),
    false,
  );
  assert.equal(
    isLegacyFinalPlanStep({ type: 'plan:step_done', step: 5, total: 5, role: 'summarizer' }),
    true,
  );
  assert.equal(
    isLegacyFinalPlanStep({ type: 'plan:step_done', step: 3, total: 3, role: 'coder' }),
    true,
  );
});

test('shouldNestStreamEventInPlan follows parentToolCallId before steps exist', () => {
  const message = {
    id: 'parent',
    segments: [
      {
        type: 'tools',
        cards: [
          {
            id: 'subagent-1',
            name: 'run_subagent',
            status: 'running',
            planRun: { phase: 'planning', steps: [] },
          },
        ],
      },
    ],
  };
  assert.equal(
    shouldNestStreamEventInPlan(message, {
      type: 'tool:start',
      id: 'read-1',
      name: 'read',
      parentToolCallId: 'subagent-1',
    }),
    true,
  );
  assert.equal(
    shouldNestStreamEventInPlan(message, {
      type: 'tool:start',
      id: 'list-1',
      name: 'list',
    }),
    false,
  );
});

test('applyStreamEventToPlanRun nests child tools before plan steps exist', () => {
  let message = {
    id: 'parent',
    role: 'general',
    segments: [
      {
        type: 'tools',
        cards: [
          {
            id: 'subagent-1',
            name: 'run_subagent',
            status: 'running',
            planRun: { phase: 'planning', steps: [] },
          },
        ],
      },
    ],
  };
  message = applyStreamEventToPlanRun(message, {
    type: 'tool:start',
    id: 'read-1',
    name: 'read',
    parentToolCallId: 'subagent-1',
  });
  const nested = message.segments[0].cards[0].planRun.steps[0].segments
    .filter((segment) => segment.type === 'tools')
    .flatMap((segment) => segment.cards);
  assert.equal(nested[0]?.id, 'read-1');
  assert.equal(
    message.segments[0].cards.some((card) => card.id === 'read-1'),
    false,
  );
});

test('applyStreamEventToPlanRun nests thinking and tools into the running step', () => {
  let message = {
    id: 'parent',
    role: 'general',
    segments: [
      {
        type: 'tools',
        cards: [
          {
            id: 'call-1',
            name: 'create_plan',
            status: 'running',
            planRun: {
              phase: 'executing',
              goal: 'Ship it',
              steps: [
                {
                  index: 1,
                  role: 'explorer',
                  title: 'Inspect',
                  status: 'running',
                  segments: [],
                },
              ],
            },
          },
        ],
      },
    ],
  };

  message = applyStreamEventToPlanRun(message, {
    type: 'assistant:reasoning_delta',
    text: 'Let me look around',
  });
  message = applyStreamEventToPlanRun(message, {
    type: 'tool:start',
    id: 'tool-1',
    name: 'read',
    displayName: 'Read',
  });

  const step = message.segments[0].cards[0].planRun.steps[0];
  assert.equal(step.segments[0].type, 'thinking');
  assert.match(step.segments[0].text, /look around/);
  assert.equal(step.segments[1].type, 'tools');
  assert.equal(step.segments[1].cards[0].name, 'read');
  // Parent message body stays free of nested plan activity.
  assert.equal(
    message.segments.filter((segment) => segment.type === 'thinking').length,
    0,
  );
});

test('upsert keeps one card per tool call id', () => {
  let message = {
    id: 'parent',
    role: 'general',
    segments: [
      {
        type: 'tools',
        cards: [
          {
            id: 'real-call',
            name: 'create_plan',
            status: 'running',
            planRun: {
              phase: 'executing',
              goal: 'Goal',
              steps: [{ index: 1, role: 'coder', title: 'Do', status: 'pending', segments: [] }],
            },
          },
        ],
      },
    ],
  };

  message = applyStreamEventToPlanRun(message, {
    type: 'tool:start',
    id: 'real-call',
    name: 'create_plan',
    displayName: 'Plan',
  });

  const planCards = message.segments
    .filter((segment) => segment.type === 'tools')
    .flatMap((segment) => segment.cards)
    .filter((card) => card.name === 'create_plan' || card.name === 'run_subagent');
  assert.equal(planCards.length, 1);
  assert.equal(planCards[0].id, 'real-call');
  assert.equal(planCards[0].planRun.phase, 'executing');
});

test('different tool call ids create separate cards', () => {
  let message = { id: 'parent', role: 'general', segments: [] };
  message = applyStreamEventToPlanRun(message, {
    type: 'tool:start',
    id: 'call-1',
    name: 'run_subagent',
  });
  message = applyStreamEventToPlanRun(message, {
    type: 'tool:start',
    id: 'call-2',
    name: 'run_subagent',
  });
  const cards = message.segments
    .filter((segment) => segment.type === 'tools')
    .flatMap((segment) => segment.cards)
    .filter((card) => card.name === 'run_subagent');
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map((card) => card.id).sort(), ['call-1', 'call-2']);
});

test('fork_task tool:start creates a plan card that plan steps update', () => {
  let message = { id: 'parent', role: 'general', segments: [] };

  message = applyStreamEventToPlanRun(message, {
    type: 'tool:start',
    id: 'fork-1',
    name: 'fork_task',
    displayName: 'Fork · frontend',
    arguments: { prompt: 'Check the frontend', name: 'frontend' },
  });
  let cards = message.segments
    .filter((segment) => segment.type === 'tools')
    .flatMap((segment) => segment.cards || []);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].name, 'fork_task');
  assert.equal(cards[0].status, 'running');
  assert.ok(cards[0].planRun, 'fork card must get a planRun');

  message = applyPlanEventToMessage(message, {
    type: 'plan:step_start',
    step: 1,
    toolCallId: 'fork-1',
    role: 'frontend',
    title: 'Check the frontend',
    status: 'running',
    model: 'mock-model',
  });
  cards = message.segments
    .filter((segment) => segment.type === 'tools')
    .flatMap((segment) => segment.cards || []);
  assert.equal(cards[0].planRun.steps[0].role, 'frontend');
  assert.equal(cards[0].planRun.steps[0].status, 'running');
  assert.equal(cards[0].planRun.steps[0].model, 'mock-model');
});

test('blocked delegation inside fork branches does not create subagent cards', () => {
  let message = { id: 'parent', role: 'general', segments: [] };
  for (const id of ['fork-a', 'fork-b']) {
    message = applyStreamEventToPlanRun(message, {
      type: 'tool:start',
      id,
      name: 'fork_task',
      arguments: { prompt: `Inspect ${id}`, name: id },
    });
    message = applyStreamEventToPlanRun(message, {
      type: 'tool:blocked',
      id: `blocked-${id}`,
      name: 'run_subagent',
      arguments: {},
      parentToolCallId: id,
    });
  }

  const cards = message.segments
    .filter((segment) => segment.type === 'tools')
    .flatMap((segment) => segment.cards || []);
  assert.deepEqual(cards.map((card) => card.name), ['fork_task', 'fork_task']);
});

test('fork branch child tools nest inside the fork card step', () => {
  let message = { id: 'parent', role: 'general', segments: [] };
  message = applyStreamEventToPlanRun(message, {
    type: 'tool:start',
    id: 'fork-1',
    name: 'fork_task',
    displayName: 'Fork · backend',
    arguments: { prompt: 'Check the backend', name: 'backend' },
  });
  message = applyPlanEventToMessage(message, {
    type: 'plan:step_start',
    step: 1,
    toolCallId: 'fork-1',
    role: 'backend',
    title: 'Check the backend',
  });

  // A tool the branch itself ran, tagged with the fork card's parentToolCallId.
  message = applyStreamEventToPlanRun(message, {
    type: 'tool:start',
    id: 'branch-read-1',
    parentToolCallId: 'fork-1',
    name: 'read',
    arguments: { file_path: 'src/backend/main.js' },
  });
  message = applyStreamEventToPlanRun(message, {
    type: 'tool:end',
    id: 'branch-read-1',
    parentToolCallId: 'fork-1',
    name: 'read',
    summary: 'Read src/backend/main.js',
  });

  const card = message.segments
    .filter((segment) => segment.type === 'tools')
    .flatMap((segment) => segment.cards || [])
    .find((item) => item.id === 'fork-1');
  const nested = (card?.planRun?.steps || [])
    .flatMap((step) => step.segments || [])
    .filter((segment) => segment.type === 'tools')
    .flatMap((segment) => segment.cards || []);
  assert.equal(nested.length, 1);
  assert.equal(nested[0].name, 'read');
  assert.equal(nested[0].id, 'branch-read-1');
});

test('fork plan:step_done carries usage onto the fork card step', () => {
  let message = { id: 'parent', role: 'general', segments: [] };
  message = applyStreamEventToPlanRun(message, {
    type: 'tool:start',
    id: 'fork-1',
    name: 'fork_task',
    displayName: 'Fork · tests',
    arguments: { prompt: 'Run the tests', name: 'tests' },
  });
  message = applyPlanEventToMessage(message, {
    type: 'plan:step_start',
    step: 1,
    toolCallId: 'fork-1',
    role: 'tests',
    title: 'Run the tests',
  });
  message = applyPlanEventToMessage(message, {
    type: 'plan:step_done',
    step: 1,
    toolCallId: 'fork-1',
    role: 'tests',
    title: 'Run the tests',
    status: 'done',
    output: 'Fork branch "tests" finished.',
    sdkProvider: 'openai-compatible',
    model: 'mock-model',
    usage: { inputTokens: 5000, outputTokens: 200, totalTokens: 5200, cachedInputTokens: 4800, requests: 1 },
    usageScope: 'fork',
  });

  const card = message.segments
    .filter((segment) => segment.type === 'tools')
    .flatMap((segment) => segment.cards || [])
    .find((item) => item.id === 'fork-1');
  assert.equal(card.status, 'done');
  assert.equal(card.planRun.phase, 'completed');
  assert.equal(card.planRun.steps[0].status, 'done');
  assert.equal(card.planRun.steps[0].usage.totalTokens, 5200);
  assert.equal(card.planRun.steps[0].usage.cachedInputTokens, 4800);
  assert.equal(card.planRun.steps[0].usage.requests, 1);
  assert.equal(card.planRun.steps[0].sdkProvider, 'openai-compatible');
  assert.equal(card.planRun.steps[0].model, 'mock-model');
  // Parent message usage stays unset; fork tokens live on the step only.
  assert.equal(message.usage, undefined);
});

test('fork_task uses the Parallel task product label', () => {
  assert.equal(planPhaseTitle('executing', { toolName: 'fork_task' }), 'Parallel task · 运行中');
  assert.equal(planPhaseTitle('completed', { toolName: 'fork_task' }), 'Parallel task · 完成');
});

test('completed fork branches settle their assigned checklist', () => {
  let message = { id: 'parent', role: 'general', segments: [] };
  const tasks = [
    { content: 'List files', status: 'in_progress' },
    { content: 'Return results', status: 'pending' },
  ];
  message = applyStreamEventToPlanRun(message, {
    type: 'tool:start',
    id: 'fork-1',
    name: 'fork_task',
    arguments: { prompt: 'Inspect files', name: 'files', tasks },
  });
  message = applyPlanEventToMessage(message, {
    type: 'plan:step_start',
    step: 1,
    toolCallId: 'fork-1',
    role: 'files',
    title: 'Inspect files',
  });
  message = applyPlanEventToMessage(message, {
    type: 'plan:step_done',
    step: 1,
    toolCallId: 'fork-1',
    role: 'files',
    title: 'Inspect files',
    status: 'done',
  });

  const card = message.segments[0].cards[0];
  assert.equal(card.status, 'done');
  assert.deepEqual(
    card.arguments.tasks.map((task) => task.status),
    ['completed', 'completed'],
  );
});

test('completed fork branches settle nested leftover tasks', () => {
  let message = { id: 'parent', role: 'general', segments: [] };
  message = applyStreamEventToPlanRun(message, {
    type: 'tool:start',
    id: 'fork-1',
    name: 'fork_task',
    arguments: { prompt: 'Inspect files', name: 'files' },
  });
  message = applyPlanEventToMessage(message, {
    type: 'plan:step_start',
    step: 1,
    toolCallId: 'fork-1',
    role: 'files',
    title: 'Inspect files',
  });
  message = applyStreamEventToPlanRun(message, {
    type: 'tool:start',
    id: 'todo-1',
    parentToolCallId: 'fork-1',
    name: 'tasks',
    arguments: {
      tasks: [
        { content: '搜索工作区所有 .py 文件', status: 'completed' },
        { content: '读取其中一个文件的头部内容并摘要', status: 'completed' },
        { content: '返回简短结论', status: 'in_progress' },
      ],
    },
  });
  message = applyPlanEventToMessage(message, {
    type: 'plan:step_done',
    step: 1,
    toolCallId: 'fork-1',
    role: 'files',
    title: 'Inspect files',
    status: 'done',
    output: '并行分支任务完成',
  });

  const card = message.segments[0].cards[0];
  const nested = card.planRun.steps[0].segments
    .filter((segment) => segment.type === 'tools')
    .flatMap((segment) => segment.cards)
    .find((item) => item.name === 'tasks');
  assert.equal(card.status, 'done');
  assert.deepEqual(
    nested.arguments.tasks.map((task) => task.status),
    ['completed', 'completed', 'completed'],
  );
});

test('failed fork branches leave nested leftover tasks incomplete', () => {
  let message = { id: 'parent', role: 'general', segments: [] };
  message = applyStreamEventToPlanRun(message, {
    type: 'tool:start',
    id: 'fork-1',
    name: 'fork_task',
    arguments: { prompt: 'Inspect files', name: 'files' },
  });
  message = applyPlanEventToMessage(message, {
    type: 'plan:step_start',
    step: 1,
    toolCallId: 'fork-1',
    role: 'files',
    title: 'Inspect files',
  });
  message = applyStreamEventToPlanRun(message, {
    type: 'tool:start',
    id: 'todo-1',
    parentToolCallId: 'fork-1',
    name: 'tasks',
    arguments: {
      tasks: [{ content: '返回简短结论', status: 'in_progress' }],
    },
  });
  message = applyPlanEventToMessage(message, {
    type: 'plan:step_done',
    step: 1,
    toolCallId: 'fork-1',
    role: 'files',
    title: 'Inspect files',
    status: 'failed',
  });

  const nested = message.segments[0].cards[0].planRun.steps[0].segments
    .filter((segment) => segment.type === 'tools')
    .flatMap((segment) => segment.cards)
    .find((item) => item.name === 'tasks');
  assert.equal(nested.arguments.tasks[0].status, 'in_progress');
});

test('successful parent completion settles leftover tasks on still-running forks', () => {
  let message = { id: 'parent', role: 'general', segments: [] };
  message = applyStreamEventToPlanRun(message, {
    type: 'tool:start',
    id: 'fork-1',
    name: 'fork_task',
    arguments: {
      prompt: 'Inspect files',
      name: 'files',
      tasks: [{ content: 'List files', status: 'in_progress' }],
    },
  });
  message = applyPlanEventToMessage(message, {
    type: 'plan:step_start',
    step: 1,
    toolCallId: 'fork-1',
    role: 'files',
    title: 'Inspect files',
  });
  message = applyStreamEventToPlanRun(message, {
    type: 'tool:start',
    id: 'todo-1',
    parentToolCallId: 'fork-1',
    name: 'tasks',
    arguments: {
      tasks: [{ content: '返回简短结论', status: 'in_progress' }],
    },
  });

  message = settleRunningCreatePlanCards(message, { reason: 'completed' });
  const card = message.segments[0].cards[0];
  const nested = card.planRun.steps[0].segments
    .filter((segment) => segment.type === 'tools')
    .flatMap((segment) => segment.cards)
    .find((item) => item.name === 'tasks');
  assert.equal(card.arguments.tasks[0].status, 'completed');
  assert.equal(nested.arguments.tasks[0].status, 'completed');
});

test('fork cards render a Parallel task identity while subagent cards stay Subagent', () => {
  const runCard = (name) => {
    let message = { id: 'parent', role: 'general', segments: [] };
    message = applyStreamEventToPlanRun(message, {
      type: 'tool:start',
      id: `${name}-1`,
      name,
      displayName: name === 'fork_task' ? 'Fork · tests' : 'Subagent · Mira',
      arguments: { name: name === 'fork_task' ? 'tests' : 'Mira', prompt: 'Do the thing' },
    });
    message = applyPlanEventToMessage(message, {
      type: 'plan:step_start',
      step: 1,
      toolCallId: `${name}-1`,
      role: name === 'fork_task' ? 'tests' : 'Mira',
      title: 'Do the thing',
    });
    message = applyPlanEventToMessage(message, {
      type: 'plan:step_done',
      step: 1,
      toolCallId: `${name}-1`,
      role: name === 'fork_task' ? 'tests' : 'Mira',
      title: 'Do the thing',
      status: 'done',
    });
    return message.segments[0].cards[0];
  };

  const forkCard = runCard('fork_task');
  assert.equal(forkCard.name, 'fork_task');
  assert.equal(forkCard.displayName, 'Parallel task · 完成');

  const subagentCard = runCard('run_subagent');
  assert.equal(subagentCard.name, 'run_subagent');
  assert.equal(subagentCard.displayName, 'Subagent · 完成');
});

test('findActivePlanParentMessage ignores background run_subagent cards', () => {
  const dispatch = {
    id: 'dispatch',
    segments: [{
      type: 'tools',
      cards: [{
        id: 'sub-1',
        name: 'run_subagent',
        status: 'running',
        arguments: { name: 'mira', paths: ['docs/a.md'] },
        planRun: { phase: 'executing', steps: [{ status: 'running' }] },
      }],
    }],
  };
  const plan = {
    id: 'plan',
    segments: [{
      type: 'tools',
      cards: [{
        id: 'plan-1',
        name: 'create_plan',
        status: 'running',
        planRun: { phase: 'executing', steps: [{ status: 'running' }] },
      }],
    }],
  };
  assert.equal(findActivePlanParentMessage([dispatch]), undefined);
  assert.equal(findActivePlanParentMessage([dispatch, plan])?.id, 'plan');
});
