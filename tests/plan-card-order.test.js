import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendTextSegment,
  appendThinkingSegment,
  applyStreamEventToMessage,
} from '../codemini-web/shared/transcript-segments.js';
import { layoutAnswerProcessWithPlans } from '../codemini-web/client/src/lib/answer-process.js';

test('appendTextSegment inserts before trailing create_plan card', () => {
  let segments = [
    {
      type: 'tools',
      cards: [{ id: 'p1', name: 'create_plan', status: 'running' }],
    },
  ];
  segments = appendThinkingSegment(segments, 'thinking first');
  segments = appendTextSegment(segments, 'create the plan now');
  assert.equal(segments[0].type, 'thinking');
  assert.equal(segments[1].type, 'text');
  assert.equal(segments[2].type, 'tools');
  assert.equal(segments[2].cards[0].name, 'create_plan');
});

test('tool_call_delta then text keeps preamble before create_plan', () => {
  let message = { id: 'm1', segments: [] };
  message = applyStreamEventToMessage(message, {
    type: 'assistant:tool_call_delta',
    toolCall: { id: 'c1', name: 'create_plan', arguments: '{}' },
  });
  message = applyStreamEventToMessage(message, {
    type: 'assistant:reasoning_delta',
    text: 'I should plan this',
  });
  message = applyStreamEventToMessage(message, {
    type: 'assistant:delta',
    text: '直接创建 plan',
  });
  assert.equal(message.segments[0].type, 'thinking');
  assert.equal(message.segments[1].type, 'text');
  assert.match(message.segments[1].text, /创建 plan/);
  assert.equal(message.segments[2].cards[0].name, 'create_plan');
});

test('layoutAnswerProcessWithPlans keeps plan between process and answer', () => {
  const layout = layoutAnswerProcessWithPlans([
    { type: 'thinking', text: 'hmm' },
    {
      type: 'tools',
      cards: [{ id: 'p1', name: 'create_plan', status: 'done', planRun: { phase: 'completed', steps: [] } }],
    },
    { type: 'text', text: 'final answer here' },
  ]);
  assert.equal(layout.hasFold, true);
  assert.equal(layout.items[0].type, 'fold');
  assert.equal(layout.items[0].groups[0].type, 'thinking');
  assert.equal(layout.items[1].type, 'group');
  assert.equal(layout.items[1].group.cards[0].name, 'create_plan');
  assert.equal(layout.items[2].group.type, 'text');
});
