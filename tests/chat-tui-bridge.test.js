import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendAssistantDelta,
  createBridgeState,
  startAssistantMessage,
  updateActivityOnAssistant
} from '../src/tui/runtime-bridge.js';

test('startAssistantMessage seeds an empty assistant bubble with metadata', () => {
  const state = createBridgeState();
  const next = startAssistantMessage(state, {
    messageId: 'a-1',
    label: 'coder',
    planStep: '1/3 · Inspect project'
  });

  assert.equal(next.activeAssistantId, 'a-1');
  assert.equal(next.messages.length, 1);
  assert.deepEqual(next.messages[0], {
    id: 'a-1',
    label: 'coder',
    text: '',
    color: 'greenBright',
    planStep: '1/3 · Inspect project',
    segments: [],
    toolCalls: [],
    pendingToolCalls: [],
    autoSkillNames: []
  });
});

test('appendAssistantDelta appends streamed text into the active assistant message', () => {
  const seeded = startAssistantMessage(createBridgeState(), {
    messageId: 'a-1',
    label: 'coder'
  });
  const next = appendAssistantDelta(seeded, 'hello');
  const final = appendAssistantDelta(next, ' world');

  assert.equal(final.messages[0].text, 'hello world');
  assert.deepEqual(final.messages[0].segments, [
    { type: 'text', text: 'hello world' }
  ]);
});

test('updateActivityOnAssistant records tool status changes on the active assistant message', () => {
  const seeded = startAssistantMessage(createBridgeState(), {
    messageId: 'a-1',
    label: 'coder'
  });
  const running = updateActivityOnAssistant(seeded, {
    type: 'tool',
    id: 'tool-1',
    name: 'Read(src/index.js)',
    status: 'running'
  });
  const done = updateActivityOnAssistant(running, {
    type: 'tool',
    id: 'tool-1',
    name: 'Read(src/index.js)',
    status: 'done',
    summary: 'read 12 lines'
  });

  assert.equal(done.messages[0].toolCalls.length, 1);
  assert.equal(done.messages[0].toolCalls[0].status, 'done');
  assert.equal(done.messages[0].toolCalls[0].summary, 'read 12 lines');
  assert.equal(done.messages[0].segments[0].status, 'done');
});
