import test from 'node:test';
import assert from 'node:assert/strict';
import { isSessionTurnBusyResult } from '../codemini-web/client/src/lib/session-turn-busy.js';
import {
  createSessionState,
  isSessionBusyInState,
  reduceSessionEvent,
} from '../codemini-web/client/src/lib/session-state.js';

test('isSessionTurnBusyResult recognizes pool and bridge busy rejects', () => {
  assert.equal(isSessionTurnBusyResult({ code: 'BUSY', error: true }), true);
  assert.equal(isSessionTurnBusyResult({ code: 'SESSION_BUSY', accepted: false }), true);
  assert.equal(
    isSessionTurnBusyResult({ error: true, message: 'A request is already in progress' }),
    true,
  );
  assert.equal(isSessionTurnBusyResult({ error: true, message: 'Missing sessionId' }), false);
  assert.equal(isSessionTurnBusyResult({ accepted: true }), false);
  assert.equal(isSessionTurnBusyResult(null), false);
});

test('submit:done from a running turn leaves the session idle for queued follow-ups', () => {
  const sessionId = 's1';
  const state = createSessionState({
    currentSessionId: sessionId,
    sessionRuntimeById: {
      [sessionId]: { sessionId, busy: true, status: 'running' },
    },
  });
  const next = reduceSessionEvent(state, {
    type: 'submit:done',
    sessionId,
    result: { type: 'assistant', text: 'done' },
  });
  assert.equal(isSessionBusyInState(state, sessionId), true);
  assert.equal(isSessionBusyInState(next, sessionId), false);
});
