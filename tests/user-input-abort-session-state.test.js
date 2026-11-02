import test from 'node:test';
import assert from 'node:assert/strict';
import { reduceSessionEvent } from '../codemini-web/client/src/lib/session-state.js';

const sessionId = 'sess-1';

function runningWithUserInput() {
  return {
    sessionRuntimeById: {
      [sessionId]: {
        sessionId,
        busy: true,
        status: 'running',
        pendingUserInput: {
          id: 'user-input-123',
          title: 'Need your input',
          questions: [{
            id: 'q1',
            label: 'Pick',
            type: 'radio',
            options: [{ label: 'A', value: 'a' }],
          }],
        },
      },
    },
    sessionMessagesById: {},
  };
}

test('aborted submit:done clears a pending user input so the session is not stuck', () => {
  const state = runningWithUserInput();
  const next = reduceSessionEvent(state, {
    type: 'submit:done',
    sessionId,
    result: { type: 'aborted', aborted: true, text: 'Request aborted.' },
  });
  const runtime = next.sessionRuntimeById[sessionId];
  assert.equal(runtime.busy, false);
  assert.equal(runtime.status, 'aborted');
  assert.equal(runtime.pendingUserInput, null);
});

test('aborted submit:done clears a pending approval too', () => {
  const state = {
    sessionRuntimeById: {
      [sessionId]: {
        sessionId,
        busy: true,
        status: 'waiting_approval',
        pendingApproval: { id: 'approval-1', toolName: 'run' },
      },
    },
    sessionMessagesById: {},
  };
  const next = reduceSessionEvent(state, {
    type: 'submit:done',
    sessionId,
    result: { type: 'aborted', aborted: true, text: 'Request aborted.' },
  });
  const runtime = next.sessionRuntimeById[sessionId];
  assert.equal(runtime.busy, false);
  assert.equal(runtime.status, 'aborted');
  assert.equal(runtime.pendingApproval, null);
});

test('non-aborted submit:done keeps the interaction open while a pending input exists', () => {
  const state = runningWithUserInput();
  const next = reduceSessionEvent(state, {
    type: 'submit:done',
    sessionId,
    result: { type: 'assistant', aborted: false, text: 'Done.' },
  });
  const runtime = next.sessionRuntimeById[sessionId];
  assert.equal(runtime.busy, true);
  assert.ok(runtime.pendingUserInput, 'pending user input should remain open');
});

test('approval requests queue instead of overwriting, then surface the next after resolve', () => {
  const base = {
    sessionRuntimeById: {
      [sessionId]: { sessionId, busy: true, status: 'running' },
    },
    sessionMessagesById: {},
  };
  const first = reduceSessionEvent(base, {
    type: 'approval:request',
    sessionId,
    id: 'approval-a',
    toolName: 'write',
  });
  const both = reduceSessionEvent(first, {
    type: 'approval:request',
    sessionId,
    id: 'approval-b',
    toolName: 'write',
  });
  let runtime = both.sessionRuntimeById[sessionId];
  assert.equal(runtime.pendingApproval.id, 'approval-a');
  assert.equal(runtime.pendingApprovals.length, 2);
  assert.equal(runtime.pendingApprovals[1].id, 'approval-b');

  const afterRunning = reduceSessionEvent(both, {
    type: 'runtime_pool_state',
    sessionId,
    state: { status: 'running', busy: true },
  });
  runtime = afterRunning.sessionRuntimeById[sessionId];
  assert.equal(runtime.pendingApproval.id, 'approval-a');
  assert.equal(runtime.pendingApprovals.length, 2);

  const afterFirst = reduceSessionEvent(afterRunning, {
    type: 'approval:resolved',
    sessionId,
    id: 'approval-a',
    approved: true,
  });
  runtime = afterFirst.sessionRuntimeById[sessionId];
  assert.equal(runtime.pendingApproval.id, 'approval-b');
  assert.equal(runtime.pendingApprovals.length, 1);

  const afterSecond = reduceSessionEvent(afterFirst, {
    type: 'approval:resolved',
    sessionId,
    id: 'approval-b',
    approved: true,
  });
  runtime = afterSecond.sessionRuntimeById[sessionId];
  assert.equal(runtime.pendingApproval, null);
  assert.deepEqual(runtime.pendingApprovals, []);
});
