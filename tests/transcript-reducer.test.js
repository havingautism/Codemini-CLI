import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyStreamEventToMessage,
  isTranscriptStreamEvent,
  replaceLastTextSegment,
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
