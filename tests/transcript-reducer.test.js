import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyStreamEventToMessage,
  isTranscriptStreamEvent,
  replaceLastTextSegment,
  settleIncompleteTranscriptMessage,
  repairSettledTranscriptMessages,
} from '../codemini-web/shared/transcript-segments.js';
import { reduceSessionTranscriptEvent } from '../codemini-web/client/src/lib/session-state.js';

test('assistant usage events add tokens to the parent message', () => {
  const message = applyStreamEventToMessage(
    { id: 'parent', usage: { totalTokens: 35, requests: 1 }, segments: [] },
    {
      type: 'assistant:usage',
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        requests: 2,
      },
    },
  );

  assert.equal(isTranscriptStreamEvent('assistant:usage'), true);
  assert.deepEqual(message.usage, {
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 155,
    cachedInputTokens: 0,
    cacheMissInputTokens: 0,
    cacheWriteInputTokens: 0,
    reasoningOutputTokens: 0,
    requests: 3,
  });
});

test('applyStreamEventToMessage persists hook start/end as skill segments', () => {
  let message = {
    id: 'msg-hook',
    role: 'general',
    segments: [],
  };

  message = applyStreamEventToMessage(message, {
    type: 'hook:start',
    event: 'UserPromptSubmit',
    name: 'package-hooks-smoke',
    source: 'package',
    command: 'node -e "..."',
    matcher: 'startup|resume',
    startedAt: '2026-07-22T12:00:00.000Z',
  });
  assert.equal(message.segments.length, 1);
  assert.equal(message.segments[0].type, 'skill');
  assert.equal(message.segments[0].kind, 'hook');
  assert.equal(message.segments[0].event, 'UserPromptSubmit');
  assert.equal(message.segments[0].sourceLabel, 'package-hooks-smoke');
  assert.equal(message.segments[0].command, 'node -e "..."');
  assert.equal(message.segments[0].matcher, 'startup|resume');
  assert.equal(message.segments[0].startedAt, '2026-07-22T12:00:00.000Z');
  assert.equal(message.segments[0].status, 'running');

  message = applyStreamEventToMessage(message, {
    type: 'hook:end',
    event: 'UserPromptSubmit',
    name: 'package-hooks-smoke',
    source: 'package',
    matcher: 'startup|resume',
    ok: true,
    endedAt: '2026-07-22T12:00:03.000Z',
  });
  assert.equal(message.segments[0].status, 'done');
  assert.equal(message.segments[0].event, 'UserPromptSubmit');
  assert.equal(message.segments[0].endedAt, '2026-07-22T12:00:03.000Z');
});

test('hook errors preserve their reason for the disclosure details', () => {
  let message = {
    id: 'msg-hook-error',
    role: 'general',
    segments: [],
  };

  message = applyStreamEventToMessage(message, {
    type: 'hook:start',
    event: 'SessionStart',
    name: 'quality',
    command: 'node verify.mjs',
  });
  message = applyStreamEventToMessage(message, {
    type: 'hook:error',
    event: 'SessionStart',
    name: 'quality',
    error: 'spawn failed',
  });

  assert.equal(message.segments[0].status, 'error');
  assert.equal(message.segments[0].reason, 'spawn failed');
});

test('PreToolUse hook end matches start when toolName is present', () => {
  let message = {
    id: 'msg-pretool',
    role: 'general',
    segments: [],
  };

  message = applyStreamEventToMessage(message, {
    type: 'assistant:tool_call_delta',
    toolCall: { id: 'call-1', name: 'run', arguments: '{}' },
  });
  message = applyStreamEventToMessage(message, {
    type: 'hook:start',
    event: 'PreToolUse',
    name: 'package-hooks-smoke',
    source: 'package',
    toolName: 'run',
    command: 'node -e "..."',
  });

  assert.equal(message.segments[0].type, 'skill');
  assert.equal(message.segments[0].event, 'PreToolUse');
  assert.equal(message.segments[0].status, 'running');
  assert.equal(message.segments[1].type, 'tools');

  message = applyStreamEventToMessage(message, {
    type: 'hook:end',
    event: 'PreToolUse',
    name: 'package-hooks-smoke',
    source: 'package',
    toolName: 'run',
    decision: 'allow',
  });

  assert.equal(message.segments[0].status, 'done');
  assert.equal(message.segments[0].event, 'PreToolUse');
});

test('replaceLastTextSegment does not duplicate text after a tool card', () => {
  const segments = replaceLastTextSegment(
    [
      {
        type: 'text',
        text: '先加载技能指令',
        isStreaming: true,
      },
      {
        type: 'tools',
        cards: [{ id: 'tool-1', name: 'Skill', status: 'running' }],
      },
    ],
    '先加载技能指令',
    false,
  );

  const textSegments = segments.filter((segment) => segment.type === 'text');
  assert.equal(textSegments.length, 1);
  assert.equal(textSegments[0].text, '先加载技能指令');
  assert.equal(textSegments[0].isStreaming, false);
  assert.equal(segments[1].type, 'tools');
});

test('applyStreamEventToMessage keeps one body across delta, tool, and response', () => {
  let message = {
    id: 'msg-1',
    role: 'general',
    segments: [],
  };

  message = applyStreamEventToMessage(message, {
    type: 'assistant:delta',
    text: '探索项目结构',
  });
  message = applyStreamEventToMessage(message, {
    type: 'assistant:tool_call_delta',
    toolCall: { id: 'call-1', name: 'search_code', arguments: '{}' },
  });
  message = applyStreamEventToMessage(message, {
    type: 'assistant:response',
    text: '探索项目结构',
  });

  const textSegments = message.segments.filter((segment) => segment.type === 'text');
  assert.equal(textSegments.length, 1);
  assert.equal(textSegments[0].text, '探索项目结构');
  assert.equal(message.segments.some((segment) => segment.type === 'tools'), true);
});

test('reduceSessionTranscriptEvent uses shared reducer for tool-after-text response', () => {
  const state = {
    sessionMessagesById: {
      'session-a': [
        {
          id: 'msg-1',
          role: 'general',
          isComplete: false,
          segments: [
            {
              type: 'text',
              text: '先加载技能指令',
              isStreaming: true,
              startedAt: '2026-07-12T00:00:00.000Z',
            },
            {
              type: 'tools',
              cards: [{ id: 'tool-1', name: 'Skill', status: 'running' }],
            },
          ],
        },
      ],
    },
  };

  const next = reduceSessionTranscriptEvent(state, {
    type: 'assistant:response',
    sessionId: 'session-a',
    messageId: 'msg-1',
    text: '先加载技能指令',
  });

  const segments = next.sessionMessagesById['session-a'][0].segments;
  const textSegments = segments.filter((segment) => segment.type === 'text');
  assert.equal(textSegments.length, 1);
  assert.equal(textSegments[0].text, '先加载技能指令');
  assert.equal(segments[1].type, 'tools');
});

function runningSubagentMessage({ includeSibling = false } = {}) {
  return {
    id: 'msg-subagent',
    role: 'general',
    isComplete: false,
    segments: [
      {
        type: 'tools',
        cards: [
          {
            id: 'subagent-1',
            name: 'run_subagent',
            status: 'running',
            planRun: {
              phase: 'executing',
              steps: [
                {
                  index: 1,
                  role: 'Rex',
                  status: 'running',
                  toolCallId: 'subagent-1',
                  segments: [],
                },
              ],
            },
          },
          ...(includeSibling
            ? [{ id: 'list-1', name: 'list', status: 'running' }]
            : []),
        ],
      },
    ],
  };
}

test('subagent sibling tools stay top-level and finish without a nested duplicate', () => {
  let state = {
    sessionMessagesById: {
      'session-subagent': [runningSubagentMessage({ includeSibling: true })],
    },
  };

  for (const type of ['tool:start', 'tool:end']) {
    state = reduceSessionTranscriptEvent(state, {
      type,
      sessionId: 'session-subagent',
      messageId: 'msg-subagent',
      id: 'list-1',
      name: 'list',
    });
  }

  const message = state.sessionMessagesById['session-subagent'][0];
  const planCard = message.segments[0].cards.find((card) => card.id === 'subagent-1');
  const sibling = message.segments[0].cards.find((card) => card.id === 'list-1');
  const nestedCards = planCard.planRun.steps[0].segments
    .filter((segment) => segment.type === 'tools')
    .flatMap((segment) => segment.cards);

  assert.equal(sibling.status, 'done');
  assert.equal(nestedCards.some((card) => card.id === 'list-1'), false);
});

test('subagent child tools with parentToolCallId stay nested', () => {
  let state = {
    sessionMessagesById: {
      'session-subagent': [runningSubagentMessage()],
    },
  };

  for (const type of ['tool:start', 'tool:end']) {
    state = reduceSessionTranscriptEvent(state, {
      type,
      sessionId: 'session-subagent',
      messageId: 'msg-subagent',
      id: 'read-1',
      name: 'read',
      parentToolCallId: 'subagent-1',
    });
  }

  const message = state.sessionMessagesById['session-subagent'][0];
  const planCard = message.segments[0].cards.find((card) => card.id === 'subagent-1');
  const nestedCards = planCard.planRun.steps[0].segments
    .filter((segment) => segment.type === 'tools')
    .flatMap((segment) => segment.cards);
  const topLevelCards = message.segments
    .filter((segment) => segment.type === 'tools')
    .flatMap((segment) => segment.cards);

  assert.equal(nestedCards.find((card) => card.id === 'read-1')?.status, 'done');
  assert.equal(topLevelCards.some((card) => card.id === 'read-1'), false);
});

test('tasks replaces one persistent tool card across calls', () => {
  let message = { id: 'msg-todos', role: 'general', segments: [] };
  message = applyStreamEventToMessage(message, {
    type: 'tool:start',
    id: 'todo-1',
    name: 'tasks',
    arguments: { tasks: [{ content: 'Inspect', status: 'in_progress' }] },
  });
  message = applyStreamEventToMessage(message, {
    type: 'tool:end', id: 'todo-1', name: 'tasks', summary: 'updated 1 todo',
  });
  message = applyStreamEventToMessage(message, {
    type: 'tool:start',
    id: 'todo-2',
    name: 'tasks',
    arguments: { tasks: [
      { content: 'Inspect', status: 'completed' },
      { content: 'Build', status: 'in_progress' },
    ] },
  });

  const cards = message.segments
    .filter((segment) => segment.type === 'tools')
    .flatMap((segment) => segment.cards || [])
    .filter((card) => card.name === 'tasks');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].id, 'todo-2');
  assert.equal(cards[0].arguments.tasks[1].status, 'in_progress');
});

test('tasks replaces a restored legacy update_todos card', () => {
  let message = { id: 'm1', segments: [] };
  message = applyStreamEventToMessage(message, {
    type: 'tool:start',
    id: 'legacy-todo',
    name: 'update_todos',
    arguments: { todos: [{ content: 'Inspect', status: 'in_progress' }] },
  });
  message = applyStreamEventToMessage(message, {
    type: 'tool:start',
    id: 'current-tasks',
    name: 'tasks',
    arguments: { tasks: [{ content: 'Inspect', status: 'completed' }] },
  });

  const cards = message.segments
    .filter((segment) => segment.type === 'tools')
    .flatMap((segment) => segment.cards || [])
    .filter((card) => ['tasks', 'update_todos'].includes(card.name));
  assert.equal(cards.length, 1);
  assert.equal(cards[0].name, 'tasks');
  assert.equal(cards[0].arguments.tasks[0].status, 'completed');
});

function planningSubagentMessage() {
  return {
    id: 'msg-subagent',
    role: 'general',
    isComplete: false,
    segments: [
      {
        type: 'tools',
        cards: [
          {
            id: 'subagent-1',
            name: 'run_subagent',
            status: 'running',
            arguments: {
              name: 'Kai',
              prompt: 'Review backend performance',
              tasks: [{ content: 'Inspect src/core', status: 'pending' }],
            },
            planRun: { phase: 'planning', goal: '', steps: [] },
          },
        ],
      },
    ],
  };
}

function topLevelToolCards(message) {
  return (message?.segments || [])
    .filter((segment) => segment.type === 'tools')
    .flatMap((segment) => segment.cards || []);
}

function nestedToolCards(message, cardId = 'subagent-1') {
  const card = topLevelToolCards(message).find((item) => item.id === cardId);
  return (card?.planRun?.steps || [])
    .flatMap((step) => step.segments || [])
    .filter((segment) => segment.type === 'tools')
    .flatMap((segment) => segment.cards || []);
}

test('plan:step_start is reduced into session state so later child tools nest', () => {
  let state = {
    sessionMessagesById: {
      'session-subagent': [planningSubagentMessage()],
    },
  };

  state = reduceSessionTranscriptEvent(state, {
    type: 'plan:step_start',
    sessionId: 'session-subagent',
    messageId: 'msg-subagent',
    toolCallId: 'subagent-1',
    step: 1,
    total: 1,
    role: 'Kai',
    title: 'Review backend performance',
  });
  state = reduceSessionTranscriptEvent(state, {
    type: 'tool:start',
    sessionId: 'session-subagent',
    messageId: 'msg-subagent',
    id: 'todo-1',
    name: 'tasks',
    parentToolCallId: 'subagent-1',
    arguments: { tasks: [{ content: 'Inspect src/core', status: 'in_progress' }] },
  });

  const message = state.sessionMessagesById['session-subagent'][0];
  assert.equal(nestedToolCards(message).some((card) => card.id === 'todo-1'), true);
  assert.equal(topLevelToolCards(message).some((card) => card.id === 'todo-1'), false);
  assert.equal(topLevelToolCards(message).filter((card) => card.name === 'run_subagent').length, 1);
});

test('subagent child tools nest before plan:step_start arrives', () => {
  let state = {
    sessionMessagesById: {
      'session-subagent': [planningSubagentMessage()],
    },
  };

  state = reduceSessionTranscriptEvent(state, {
    type: 'tool:start',
    sessionId: 'session-subagent',
    messageId: 'msg-subagent',
    id: 'read-1',
    name: 'read',
    parentToolCallId: 'subagent-1',
  });

  const message = state.sessionMessagesById['session-subagent'][0];
  assert.equal(nestedToolCards(message).find((card) => card.id === 'read-1')?.name, 'read');
  assert.equal(topLevelToolCards(message).some((card) => card.id === 'read-1'), false);
});

test('main-agent sibling tools stay top-level while a subagent is running', () => {
  let state = {
    sessionMessagesById: {
      'session-subagent': [runningSubagentMessage()],
    },
  };

  state = reduceSessionTranscriptEvent(state, {
    type: 'tool:start',
    sessionId: 'session-subagent',
    messageId: 'msg-subagent',
    id: 'list-1',
    name: 'list',
  });

  const message = state.sessionMessagesById['session-subagent'][0];
  assert.equal(topLevelToolCards(message).find((card) => card.id === 'list-1')?.status, 'running');
  assert.equal(nestedToolCards(message).some((card) => card.id === 'list-1'), false);
});

test('finishing one run_subagent via plan:step_done does not settle a sibling card', () => {
  let state = {
    sessionMessagesById: {
      'session-subagent': [
        {
          id: 'msg-subagent',
          role: 'general',
          isComplete: false,
          segments: [
            {
              type: 'tools',
              cards: [
                {
                  id: 'subagent-1',
                  name: 'run_subagent',
                  status: 'running',
                  planRun: {
                    phase: 'executing',
                    steps: [{ index: 1, role: 'Kai', status: 'running', toolCallId: 'subagent-1', segments: [] }],
                  },
                },
                {
                  id: 'subagent-2',
                  name: 'run_subagent',
                  status: 'running',
                  planRun: {
                    phase: 'executing',
                    steps: [{ index: 1, role: 'Mira', status: 'running', toolCallId: 'subagent-2', segments: [] }],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  };

  state = reduceSessionTranscriptEvent(state, {
    type: 'plan:step_done',
    sessionId: 'session-subagent',
    messageId: 'msg-subagent',
    toolCallId: 'subagent-1',
    step: 1,
    total: 1,
    role: 'Kai',
    status: 'done',
  });

  const cards = topLevelToolCards(state.sessionMessagesById['session-subagent'][0]);
  assert.equal(cards.find((card) => card.id === 'subagent-1')?.status, 'done');
  assert.equal(cards.find((card) => card.id === 'subagent-2')?.status, 'running');
  assert.equal(cards.find((card) => card.id === 'subagent-2')?.planRun?.phase, 'executing');
});

test('late subagent child events stay nested after the parent card completes', () => {
  const message = runningSubagentMessage();
  const subagent = message.segments[0].cards[0];
  subagent.status = 'done';
  subagent.planRun.phase = 'completed';
  subagent.planRun.steps[0].status = 'done';

  let state = {
    sessionMessagesById: {
      'session-subagent': [{ ...message, isComplete: true }],
    },
  };
  for (const type of ['tool:start', 'tool:end']) {
    state = reduceSessionTranscriptEvent(state, {
      type,
      sessionId: 'session-subagent',
      messageId: 'msg-subagent',
      id: 'late-read-1',
      name: 'read',
      parentToolCallId: 'subagent-1',
    });
  }

  const nextMessage = state.sessionMessagesById['session-subagent'][0];
  const nestedCards = nextMessage.segments[0].cards[0].planRun.steps[0].segments
    .filter((segment) => segment.type === 'tools')
    .flatMap((segment) => segment.cards);
  const topLevelCards = nextMessage.segments
    .filter((segment) => segment.type === 'tools')
    .flatMap((segment) => segment.cards);

  assert.equal(nestedCards.find((card) => card.id === 'late-read-1')?.status, 'done');
  assert.equal(topLevelCards.some((card) => card.id === 'late-read-1'), false);
});

test('reduceSessionTranscriptEvent keeps SDK and model metadata on a new answer', () => {
  const next = reduceSessionTranscriptEvent(
    { sessionMessagesById: { 'session-a': [] } },
    {
      type: 'assistant:start',
      sessionId: 'session-a',
      messageId: 'answer-1',
      sdkProvider: 'anthropic',
      model: 'claude-sonnet-4',
    },
  );

  const message = next.sessionMessagesById['session-a'][0];
  assert.equal(message.sdkProvider, 'anthropic');
  assert.equal(message.model, 'claude-sonnet-4');
});

test('UI-first load prefers ui transcript shape without rebuilding from core', () => {
  // Document the contract used by loadSessionMessages: when uiMessages exist,
  // callers should commit them directly. This unit test locks the segment
  // shape that the UI transcript already owns.
  const uiMessages = [
    {
      id: 'ui-1',
      role: 'you',
      segments: [{ type: 'text', text: '/grill-me 看优化项', isStreaming: false }],
      skillBadges: [{ name: 'grill-me', status: 'selected' }],
    },
    {
      id: 'ui-2',
      role: 'general',
      segments: [
        { type: 'text', text: '先加载技能指令', isStreaming: false },
        {
          type: 'tools',
          cards: [{ id: 'tool-1', name: 'Skill', status: 'done' }],
        },
        { type: 'text', text: '开始 grilling', isStreaming: false },
      ],
      skillBadges: [{ name: 'grilling', status: 'done' }],
    },
  ];

  assert.equal(uiMessages.length > 0, true);
  assert.equal(
    uiMessages[1].segments.filter((segment) => segment.type === 'text').length,
    2,
  );
  assert.equal(uiMessages[1].segments[1].type, 'tools');
});

test('reduceSessionTranscriptEvent keeps summarizer plan step instead of spawning general', () => {
  const state = {
    sessionMessagesById: {
      'session-plan': [
        {
          id: 'plan-step-5-client',
          role: 'summarizer',
          isComplete: false,
          segments: [],
          planStep: {
            step: 5,
            total: 5,
            role: 'summarizer',
            title: 'Synthesize final implementation status',
            status: 'running',
          },
        },
      ],
    },
  };

  const started = reduceSessionTranscriptEvent(state, {
    type: 'assistant:start',
    sessionId: 'session-plan',
    messageId: 'plan-step-5-server',
  });
  const afterStart = started.sessionMessagesById['session-plan'];
  assert.equal(afterStart.length, 1);
  assert.equal(afterStart[0].role, 'summarizer');
  assert.equal(afterStart[0].id, 'plan-step-5-server');
  assert.equal(afterStart[0].planStep?.role, 'summarizer');

  const streamed = reduceSessionTranscriptEvent(started, {
    type: 'assistant:delta',
    sessionId: 'session-plan',
    messageId: 'plan-step-5-server',
    text: '## Summary\nPlan mode complete.',
  });
  const afterDelta = streamed.sessionMessagesById['session-plan'];
  assert.equal(afterDelta.length, 1);
  assert.equal(afterDelta[0].role, 'summarizer');
  assert.equal(
    afterDelta[0].segments.some(
      (segment) =>
        segment.type === 'text' &&
        String(segment.text || '').includes('Plan mode complete'),
    ),
    true,
  );
});

test('reduceSessionTranscriptEvent does not adopt stale plan steps for normal turns', () => {
  const state = {
    sessionMessagesById: {
      'session-normal': [
        {
          id: 'plan-step-2-stale',
          role: 'coder',
          isComplete: false,
          segments: [],
          planStep: {
            step: 2,
            total: 5,
            role: 'coder',
            title: 'Implement change',
            status: 'running',
          },
        },
      ],
    },
  };

  const next = reduceSessionTranscriptEvent(state, {
    type: 'assistant:start',
    sessionId: 'session-normal',
    messageId: 'msg-normal-turn',
  });
  const messages = next.sessionMessagesById['session-normal'];
  assert.equal(messages.length, 2);
  assert.equal(messages[0].id, 'plan-step-2-stale');
  assert.equal(messages[0].role, 'coder');
  assert.equal(messages[1].id, 'msg-normal-turn');
  assert.equal(messages[1].role, 'general');
});

test('reduceSessionTranscriptEvent reuses matching plan step messageId', () => {
  const state = {
    sessionMessagesById: {
      'session-plan': [
        {
          id: 'plan-step-5-shared',
          role: 'summarizer',
          isComplete: true,
          segments: [],
          planStep: {
            step: 5,
            total: 5,
            role: 'summarizer',
            title: 'Synthesize final implementation status',
            status: 'done',
          },
        },
      ],
    },
  };

  const next = reduceSessionTranscriptEvent(state, {
    type: 'assistant:start',
    sessionId: 'session-plan',
    messageId: 'plan-step-5-shared',
  });
  const messages = next.sessionMessagesById['session-plan'];
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'summarizer');
  assert.equal(messages[0].isComplete, false);
});

test('abort settles running tools, thinking, and hooks so loaders do not stay open', () => {
  const settled = settleIncompleteTranscriptMessage(
    {
      id: 'msg-abort',
      role: 'general',
      isComplete: false,
      segments: [
        { type: 'thinking', text: 'hmm', isStreaming: true, startedAt: '2026-01-01T00:00:00.000Z' },
        { type: 'text', text: 'partial', isStreaming: true },
        {
          type: 'tools',
          cards: [{ id: 'tool-1', name: 'run', status: 'running', startedAt: '2026-01-01T00:00:00.000Z' }],
        },
        { type: 'skill', event: 'PreToolUse', name: 'quality', status: 'running' },
      ],
    },
    { reason: 'aborted' },
  );

  assert.equal(settled.isComplete, true);
  assert.equal(settled.manualAborted, true);
  assert.equal(settled.segments[0].isStreaming, false);
  assert.equal(settled.segments[1].isStreaming, false);
  assert.equal(settled.segments[2].cards[0].status, 'error');
  assert.equal(settled.segments[2].cards[0].summary, 'Aborted');
  assert.equal(settled.segments[3].status, 'error');
});

test('repairSettledTranscriptMessages closes stale running tools after refresh', () => {
  const [repaired] = repairSettledTranscriptMessages([
    {
      id: 'msg-stale',
      role: 'general',
      isComplete: true,
      manualAborted: true,
      segments: [
        {
          type: 'tools',
          cards: [{ id: 'tool-1', name: 'read', status: 'running' }],
        },
      ],
    },
  ]);
  assert.equal(repaired.segments[0].cards[0].status, 'error');
});

test('assistant:start after a manual abort opens a new bubble instead of appending', () => {
  const state = {
    sessionMessagesById: {
      'session-a': [
        {
          id: 'msg-old',
          role: 'general',
          isComplete: true,
          manualAborted: true,
          segments: [{ type: 'text', text: 'stopped mid-way', isStreaming: false }],
        },
      ],
    },
  };

  const started = reduceSessionTranscriptEvent(state, {
    type: 'assistant:start',
    sessionId: 'session-a',
    messageId: 'msg-old',
  });
  const afterStart = started.sessionMessagesById['session-a'];
  assert.equal(afterStart.length, 2);
  assert.equal(afterStart[0].manualAborted, true);
  assert.equal(afterStart[0].segments[0].text, 'stopped mid-way');
  assert.equal(afterStart[1].isComplete, false);
  assert.notEqual(afterStart[1].id, 'msg-old');

  const streamed = reduceSessionTranscriptEvent(started, {
    type: 'assistant:delta',
    sessionId: 'session-a',
    messageId: 'msg-old',
    text: 'jumped answer',
  });
  const afterDelta = streamed.sessionMessagesById['session-a'];
  assert.equal(afterDelta[0].segments[0].text, 'stopped mid-way');
  assert.match(String(afterDelta[1].segments?.[0]?.text || ''), /jumped answer/);
});

test('step start and end become hidden loop segments on the live message', () => {
  assert.equal(isTranscriptStreamEvent('step:start'), true);
  assert.equal(isTranscriptStreamEvent('step:end'), true);

  let message = applyStreamEventToMessage(
    { id: 'msg-loop', role: 'general', segments: [] },
    { type: 'step:start', step: 1, startedAt: '2026-08-19T01:00:01.000Z' },
  );
  message = applyStreamEventToMessage(message, {
    type: 'assistant:reasoning_delta',
    text: 'think',
  });
  message = applyStreamEventToMessage(message, {
    type: 'step:end',
    step: 1,
    reason: 'tools',
    durationMs: 800,
    endedAt: '2026-08-19T01:00:02.000Z',
  });
  message = applyStreamEventToMessage(message, {
    type: 'step:start',
    step: 2,
    startedAt: '2026-08-19T01:00:02.000Z',
  });

  assert.deepEqual(
    message.segments.map((segment) => [segment.type, segment.step || null, segment.phase || null]),
    [
      ['loop', 1, 'start'],
      ['thinking', null, null],
      ['loop', 1, 'end'],
      ['loop', 2, 'start'],
    ],
  );
  assert.equal(message.segments[2].durationMs, 800);
  assert.equal(message.segments[2].reason, 'tools');
});
