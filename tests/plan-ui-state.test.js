import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPlanEventToMessage,
  applyStreamEventToPlanRun,
  findPlanStepMessageId,
  planPhaseTitle,
  planRunFromTranscript,
  settleCompletedPlanToolCards,
  settleRunningCreatePlanCards,
  updatePlanOverviewStepStatus,
} from '../codemini-web/client/src/lib/plan-ui-state.js';

test('planPhaseTitle maps phases', () => {
  assert.equal(planPhaseTitle('planning'), 'Plan · 规划');
  assert.equal(planPhaseTitle('executing'), 'Plan · 执行');
  assert.equal(planPhaseTitle('completed'), 'Plan · 完成');
  assert.equal(planPhaseTitle('failed'), 'Plan · 失败');
  assert.equal(planPhaseTitle('aborted'), 'Plan · 已中止');
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
  assert.equal(message.segments[0].cards[0].displayName, 'Plan · 执行');

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
  assert.equal(card.displayName, 'Plan · 完成');
  assert.equal(card.planRun.steps[1].segments[0].type, 'text');
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

test('upsert keeps a single create_plan card when stream and plan events race', () => {
  let message = {
    id: 'parent',
    role: 'general',
    segments: [
      {
        type: 'tools',
        cards: [
          {
            id: 'synthetic',
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
    .filter((card) => card.name === 'create_plan');
  assert.equal(planCards.length, 1);
  assert.equal(planCards[0].id, 'real-call');
  assert.equal(planCards[0].planRun.phase, 'executing');
});
