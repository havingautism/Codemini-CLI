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
