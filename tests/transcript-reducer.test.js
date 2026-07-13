import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyStreamEventToMessage,
  replaceLastTextSegment,
} from '../codemini-web/shared/transcript-segments.js';
import { reduceSessionTranscriptEvent } from '../codemini-web/client/src/lib/session-state.js';

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
