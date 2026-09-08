import test from 'node:test';
import assert from 'node:assert/strict';

import { reduceSessionTranscriptEvent } from '../codemini-web/client/src/lib/session-state.js';

const sessionId = 'sess-1';

function stateWithMessages(messages, { crewActive = true } = {}) {
  return {
    runtimeState: { sessionId, crewActive },
    sessionRuntimeById: { [sessionId]: { sessionId, crewActive } },
    sessionMessagesById: { [sessionId]: messages },
  };
}

test('crew:wake inserts a live divider instead of merging into the dispatch bubble', () => {
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
      type: 'crew:wake',
      sessionId,
      headline: 'Crew worker "mira" completed.',
      messageId: 'wake-1',
    },
  );
  const messages = next.sessionMessagesById[sessionId];
  assert.equal(messages.length, 2);
  assert.equal(messages[1].role, 'divider');
  assert.equal(messages[1].dividerType, 'crew-wake');
  assert.match(messages[1].text, /mira/);
});

test('later assistant:start after a running crew dispatch creates a new bubble', () => {
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

test('crew review wake settles a stuck running reviewer card', () => {
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
      type: 'crew:wake',
      sessionId,
      headline: 'Crew review of "workera" finished (completed).',
      messageId: 'wake-review',
    },
  );
  const card = next.sessionMessagesById[sessionId][0].segments[0].cards[0];
  assert.equal(card.status, 'done');
  assert.equal(card.planRun.phase, 'completed');
  assert.equal(next.sessionMessagesById[sessionId][1].dividerType, 'crew-wake');
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

test('reviewer plan:step_start updates the live spawn card instead of waiting for crew idle', () => {
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
      crewKind: 'review',
      title: 'Crew review · lena',
      step: 1,
      status: 'running',
    },
  );
  const card = next.sessionMessagesById[sessionId][0].segments[0].cards[0];
  assert.equal(card.planRun?.steps?.[0]?.title, 'Crew review · lena');
  assert.equal(card.planRun?.steps?.[0]?.status, 'running');
});

test('plan:step_done updates the spawn bubble when an earlier leak exists', () => {
  const leaked = {
    id: 'first-turn',
    role: 'general',
    isComplete: true,
    segments: [{
      type: 'tools',
      cards: [
        {
          id: 'call-md',
          name: 'run_subagent',
          status: 'done',
          arguments: { name: 'doc-md', paths: ['docs/test.md'] },
          planRun: { phase: 'completed', steps: [{ status: 'done' }] },
        },
        {
          id: 'call-txt',
          name: 'run_subagent',
          status: 'running',
          arguments: {},
          planRun: {
            phase: 'executing',
            steps: [{ toolCallId: 'call-txt', role: 'Doc-txt', title: 'write txt', status: 'running' }],
          },
        },
      ],
    }],
  };
  const spawn = {
    id: 'second-turn',
    role: 'general',
    isComplete: true,
    segments: [{
      type: 'tools',
      cards: [{
        id: 'call-txt',
        name: 'run_subagent',
        status: 'running',
        arguments: { name: 'doc-txt', paths: ['docs/test.txt'], prompt: 'write txt' },
        planRun: { phase: 'executing', steps: [] },
      }],
    }],
  };
  const next = reduceSessionTranscriptEvent(
    stateWithMessages([leaked, spawn]),
    {
      type: 'plan:step_done',
      sessionId,
      toolCallId: 'call-txt',
      title: 'Crew worker · doc-txt',
      step: 1,
      status: 'done',
    },
  );
  const messages = next.sessionMessagesById[sessionId];
  const spawnCard = messages
    .find((message) => message.id === 'second-turn')
    .segments[0].cards.find((card) => card.id === 'call-txt');
  assert.equal(spawnCard.status, 'done');
  assert.equal(spawnCard.planRun.phase, 'completed');
  const firstCards = messages.find((message) => message.id === 'first-turn').segments[0].cards;
  assert.equal(firstCards.some((card) => card.id === 'call-txt'), false);
  assert.equal(firstCards.some((card) => card.id === 'call-md'), true);
});

test('cancel_worker settles the matching crew card as cancelled not completed', () => {
  const dispatch = {
    id: 'first-turn',
    role: 'general',
    isComplete: true,
    segments: [{
      type: 'tools',
      cards: [{
        id: 'call-html',
        name: 'run_subagent',
        status: 'done',
        arguments: { name: 'doc-html', paths: ['docs/test.html'], prompt: 'write html' },
        planRun: {
          phase: 'completed',
          steps: [{ role: 'doc-html', title: 'Crew worker · doc-html', status: 'done' }],
        },
      }],
    }],
  };
  const cancelTurn = {
    id: 'second-turn',
    role: 'general',
    isComplete: false,
    segments: [],
  };
  const started = reduceSessionTranscriptEvent(
    stateWithMessages([dispatch, cancelTurn]),
    {
      type: 'tool:start',
      sessionId,
      messageId: 'second-turn',
      id: 'call-cancel',
      name: 'cancel_worker',
      arguments: { worker_id: 'doc-html' },
    },
  );
  const next = reduceSessionTranscriptEvent(started, {
    type: 'tool:end',
    sessionId,
    messageId: 'second-turn',
    id: 'call-cancel',
    name: 'cancel_worker',
    arguments: { worker_id: 'doc-html' },
  });
  const html = next.sessionMessagesById[sessionId][0].segments[0].cards[0];
  assert.equal(html.planRun.phase, 'cancelled');
  assert.equal(html.planRun.steps[0].status, 'cancelled');
  assert.equal(html.status, 'done');
});
