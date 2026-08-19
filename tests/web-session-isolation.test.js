import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activateSession,
  isSessionBusyInState,
  projectVisibleSessionState,
} from '../codemini-web/client/src/lib/session-state.js';
import { rekeyPendingQueue } from '../codemini-web/client/src/lib/session-ui-state.js';

function busySessionAState(overrides = {}) {
  return {
    currentSessionId: 'session-a',
    busy: true,
    live: true,
    stage: 'thinking',
    stageLabel: 'Waiting',
    runtimeState: {
      sessionId: 'session-a',
      model: 'model-a',
      busy: true,
      status: 'running',
      pendingApproval: { id: 'approval-a' },
    },
    approvalRequest: { id: 'approval-a' },
    userInputRequest: { id: 'input-a' },
    sessionRuntimeById: {
      'session-a': {
        sessionId: 'session-a',
        status: 'running',
        busy: true,
        pendingApproval: { id: 'approval-a' },
      },
    },
    sessionMessagesById: {
      'session-a': [{ id: 'a-1', role: 'you', text: 'from A' }],
    },
    messages: [{ id: 'a-1', role: 'you', text: 'from A' }],
    ...overrides,
  };
}

test('switching to a new empty session does not keep the previous session busy', () => {
  const activated = activateSession(busySessionAState(), 'session-b');
  const visible = projectVisibleSessionState(activated);

  assert.equal(activated.currentSessionId, 'session-b');
  assert.equal(activated.busy, false);
  assert.equal(activated.live, false);
  assert.equal(activated.runtimeState.sessionId, 'session-b');
  assert.equal(activated.approvalRequest, null);
  assert.deepEqual(activated.messages, []);
  assert.equal(visible.busy, false);
  assert.equal(visible.live, false);
  assert.equal(visible.runtimeState.sessionId, 'session-b');
  assert.equal(isSessionBusyInState(activated, 'session-b'), false);
  assert.equal(isSessionBusyInState(activated, 'session-a'), true);
});

test('projectVisibleSessionState does not leak busy when the new session has no runtime yet', () => {
  const state = {
    ...busySessionAState(),
    currentSessionId: 'session-b',
    messages: [],
  };
  const visible = projectVisibleSessionState(state);

  assert.equal(visible.currentSessionId, 'session-b');
  assert.equal(visible.busy, false);
  assert.equal(visible.live, false);
  assert.equal(visible.stage, 'idle');
  assert.equal(visible.runtimeState.sessionId, 'session-b');
});

test('isSessionBusyInState only follows the target session runtime', () => {
  const state = busySessionAState({
    currentSessionId: 'session-b',
    busy: true,
    live: true,
    sessionRuntimeById: {
      'session-a': { sessionId: 'session-a', status: 'running', busy: true },
      'session-b': { sessionId: 'session-b', status: 'idle', busy: false },
    },
  });

  assert.equal(isSessionBusyInState(state, 'session-a'), true);
  assert.equal(isSessionBusyInState(state, 'session-b'), false);
});

test('rekeyPendingQueue moves only the forked session queue', () => {
  const queues = new Map([
    ['session-a', [{ message: { text: 'from A' } }]],
    ['session-b', [{ message: { text: 'from B' } }]],
  ]);

  const next = rekeyPendingQueue(queues, 'session-a', 'session-a-next');

  assert.equal(next.has('session-a'), false);
  assert.deepEqual(
    next.get('session-a-next').map((item) => item.message.text),
    ['from A'],
  );
  assert.deepEqual(
    next.get('session-b').map((item) => item.message.text),
    ['from B'],
  );
});
