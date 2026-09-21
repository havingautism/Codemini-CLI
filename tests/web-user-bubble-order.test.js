import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  createSessionState,
  reduceSessionEvent,
} from '../codemini-web/client/src/lib/session-state.js';

function runSubmitPromptSource(source) {
  const start = source.indexOf('const runSubmitPrompt = async');
  assert.ok(start >= 0, 'runSubmitPrompt must exist');
  const end = source.indexOf('const submitRef', start);
  assert.ok(end > start, 'runSubmitPrompt must end before submitRef');
  return source.slice(start, end);
}

test('web paints the user bubble after HTTP 202, not before POST', async () => {
  const source = await fs.readFile(
    'codemini-web/client/src/context/app-context.jsx',
    'utf8',
  );
  const fn = runSubmitPromptSource(source);
  const addAt = fn.indexOf('addMessage(youMessage)');
  const submitAt = fn.indexOf('api.submitMessage');
  const busyAt = fn.indexOf('isSessionTurnBusyResult');
  assert.ok(addAt >= 0, 'user bubble must be painted in runSubmitPrompt');
  assert.ok(submitAt >= 0, 'submitMessage must exist in runSubmitPrompt');
  assert.ok(
    submitAt < addAt,
    'user bubble must wait for HTTP 202 so unaccepted turns do not leave a fake question',
  );
  assert.ok(
    busyAt >= 0 && busyAt < addAt,
    'BUSY must return before painting the user bubble',
  );
  assert.doesNotMatch(fn, /insertAcceptedUserMessage/);
  assert.doesNotMatch(fn, /dropOptimisticUserMessage/);
});

test('queued follow-up stays in the composer until drain; wake bars still append', () => {
  const sessionId = 's1';
  const withUser = reduceSessionEvent(
    createSessionState({
      currentSessionId: sessionId,
      sessionMessagesById: {
        [sessionId]: [
          {
            id: 'u1',
            role: 'you',
            text: '现在做到哪了？',
            isComplete: true,
          },
        ],
      },
    }),
    {
      type: 'assistant:start',
      sessionId,
      messageId: 'a1',
    },
  );
  const withWake = reduceSessionEvent(withUser, {
    type: 'crew:wake',
    sessionId,
    pending: true,
    messageId: 'wake-1',
    headline: 'Crew review of "mia" finished (completed).',
  });
  const ids = (withWake.sessionMessagesById[sessionId] || []).map(
    (message) => `${message.role}:${message.id}`,
  );
  assert.deepEqual(ids, [
    'you:u1',
    'general:a1',
    'divider:wake-1',
  ]);
});
