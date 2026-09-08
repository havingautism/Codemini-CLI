import test from 'node:test';
import assert from 'node:assert/strict';

import { reduceSessionTranscriptEvent } from '../codemini-web/client/src/lib/session-state.js';

const sessionId = 'sess-1';

function stateWithMessages(messages, { towerActive = true } = {}) {
  return {
    runtimeState: { sessionId, towerActive },
    sessionRuntimeById: { [sessionId]: { sessionId, towerActive } },
    sessionMessagesById: { [sessionId]: messages },
  };
}

test('tower:wake inserts a live divider instead of merging into the dispatch bubble', () => {
  const dispatch = {
    id: 'dispatch',
    role: 'general',
    isComplete: false,
    segments: [{
      type: 'tools',
      cards: [{
        id: 'call-mira',
        name: 'run_subagent',
        status: 'running',
        planRun: { phase: 'executing', steps: [{ status: 'running' }] },
      }],
    }],
  };
  const next = reduceSessionTranscriptEvent(
    stateWithMessages([dispatch]),
    {
      type: 'tower:wake',
      sessionId,
      headline: 'Tower worker "mira" completed.',
      messageId: 'wake-1',
    },
  );
  const messages = next.sessionMessagesById[sessionId];
  assert.equal(messages.length, 2);
  assert.equal(messages[1].role, 'divider');
  assert.equal(messages[1].dividerType, 'tower-wake');
  assert.match(messages[1].text, /mira/);
});

test('later assistant:start after a running tower dispatch creates a new bubble', () => {
  const dispatch = {
    id: 'dispatch',
    role: 'general',
    isComplete: true,
    segments: [{
      type: 'tools',
      cards: [{
        id: 'call-mira',
        name: 'run_subagent',
        status: 'running',
        planRun: { phase: 'executing', steps: [{ status: 'running' }] },
      }],
    }],
  };
  const next = reduceSessionTranscriptEvent(
    stateWithMessages([dispatch]),
    {
      type: 'assistant:start',
      sessionId,
      messageId: 'wake-reply',
    },
  );
  const messages = next.sessionMessagesById[sessionId];
  assert.equal(messages.some((message) => message.id === 'wake-reply'), true);
  assert.equal(messages.find((message) => message.id === 'dispatch').segments[0].cards.length, 1);
});

test('reviewer plan:step_done settles the dispatch card even if a leaked bubble exists', () => {
  const dispatch = {
    id: 'wake-reply',
    role: 'general',
    isComplete: true,
    segments: [{
      type: 'tools',
      cards: [{
        id: 'review-workera',
        name: 'run_subagent',
        status: 'running',
        arguments: { role: 'reviewer', review: 'workera' },
        planRun: {
          phase: 'executing',
          steps: [{ toolCallId: 'review-workera', title: 'Crew review · workera', status: 'running' }],
        },
      }],
    }],
  };
  const leaked = {
    id: 'leaked-worker',
    role: 'general',
    isComplete: false,
    segments: [{
      type: 'tools',
      cards: [{
        id: 'review-workera',
        name: 'run_subagent',
        status: 'running',
        planRun: {
          phase: 'executing',
          steps: [{ toolCallId: 'review-workera', title: 'Crew review · workera', status: 'running' }],
        },
      }],
    }],
  };
  const next = reduceSessionTranscriptEvent(
    stateWithMessages([dispatch, leaked]),
    {
      type: 'plan:step_done',
      sessionId,
      toolCallId: 'review-workera',
      title: 'Crew review · workera',
      step: 1,
      status: 'done',
    },
  );
  const cards = next.sessionMessagesById[sessionId][0].segments[0].cards[0];
  assert.equal(cards.planRun.steps[0].status, 'done');
  assert.equal(cards.status, 'done');
});

test('tower review wake settles a stuck running reviewer card', () => {
  const dispatch = {
    id: 'wake-reply',
    role: 'general',
    isComplete: true,
    segments: [{
      type: 'tools',
      cards: [{
        id: 'review-workera',
        name: 'run_subagent',
        status: 'running',
        arguments: { role: 'reviewer', review: 'workera' },
        planRun: {
          phase: 'executing',
          steps: [{ title: 'Crew review · workera', status: 'running' }],
        },
      }],
    }],
  };
  const next = reduceSessionTranscriptEvent(
    stateWithMessages([dispatch]),
    {
      type: 'tower:wake',
      sessionId,
      headline: 'Crew review of "workera" finished (completed).',
      messageId: 'wake-review',
    },
  );
  const card = next.sessionMessagesById[sessionId][0].segments[0].cards[0];
  assert.equal(card.status, 'done');
  assert.equal(card.planRun.phase, 'completed');
  assert.equal(next.sessionMessagesById[sessionId][1].dividerType, 'tower-wake');
});

test('nested worker assistant:start does not open a sibling bubble', () => {
  const dispatch = {
    id: 'dispatch',
    role: 'general',
    isComplete: true,
    segments: [{
      type: 'tools',
      cards: [{
        id: 'sub-1',
        name: 'run_subagent',
        status: 'running',
        arguments: { name: 'workera', paths: ['docs/workerA_test.txt'] },
        planRun: { phase: 'executing', steps: [{ status: 'running' }] },
      }],
    }],
  };
  const next = reduceSessionTranscriptEvent(
    stateWithMessages([dispatch]),
    {
      type: 'assistant:start',
      sessionId,
      parentToolCallId: 'sub-1',
      messageId: 'should-not-create',
    },
  );
  const messages = next.sessionMessagesById[sessionId];
  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, 'dispatch');
});

test('reviewer plan:step_start updates the live spawn card instead of waiting for tower idle', () => {
  const reply = {
    id: 'wake-reply',
    role: 'general',
    isComplete: false,
    segments: [{
      type: 'tools',
      cards: [{
        id: 'review-lena',
        name: 'run_subagent',
        status: 'running',
        arguments: { role: 'reviewer', review: 'lena' },
      }],
    }],
  };
  const next = reduceSessionTranscriptEvent(
    stateWithMessages([reply]),
    {
      type: 'plan:step_start',
      sessionId,
      messageId: 'wake-reply',
      toolCallId: 'review-lena',
      towerKind: 'review',
      title: 'Crew review · lena',
      step: 1,
      status: 'running',
    },
  );
  const card = next.sessionMessagesById[sessionId][0].segments[0].cards[0];
  assert.equal(card.planRun?.steps?.[0]?.title, 'Crew review · lena');
  assert.equal(card.planRun?.steps?.[0]?.status, 'running');
});
