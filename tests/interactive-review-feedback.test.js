import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getBuiltinTools } from '../src/core/tools.js';
import { resolvePendingApproval } from '../src/core/chat-runtime.js';
import { UserInputManager } from '../codemini-web/lib/user-input-manager.js';

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('request_user_input offers an other answer for choice questions by default', async () => {
  let receivedRequest = null;
  const tools = getBuiltinTools({
    workspaceRoot: process.cwd(),
    config: {},
    requestUserInput: async (request) => {
      receivedRequest = request;
      return { status: 'skipped', answers: {} };
    },
  });

  try {
    await tools.handlers.request_user_input({
      questions: [{
        id: 'direction',
        label: 'Choose a direction',
        type: 'radio',
        options: [{ label: 'A', value: 'a' }],
      }],
    });
    assert.equal(receivedRequest.questions[0].allow_other, true);
  } finally {
    await tools.dispose();
  }
});

test('tool approval rejection preserves custom feedback for the agent loop', () => {
  let resolution = null;
  const state = {
    current: {
      id: 'approval-1',
      resolve(value) {
        resolution = value;
      },
    },
  };

  resolvePendingApproval(state, 'approval-1', {
    approved: false,
    reason: 'Use the existing helper instead.',
  });

  assert.deepEqual(resolution, {
    approved: false,
    reason: 'Use the existing helper instead.',
  });
});

test('user input manager preserves a global custom response', async () => {
  const manager = new UserInputManager();
  const responsePromise = manager.create('input-1', { title: 'Question' });

  assert.equal(manager.resolve('input-1', {
    status: 'submitted',
    answers: {},
    custom_response: '  Use SQLite and keep the API minimal.  ',
  }), true);

  assert.deepEqual(await responsePromise, {
    status: 'submitted',
    answers: {},
    custom_response: 'Use SQLite and keep the API minimal.',
  });
});

test('review dialogs expose progressive custom-response controls', () => {
  const approvalDialog = source('codemini-web/client/src/components/ApprovalDialog.jsx');
  const userInputDialog = source('codemini-web/client/src/components/UserInputDialog.jsx');
  const appContext = source('codemini-web/client/src/context/app-context.jsx');
  const webServer = source('codemini-web/server.js');

  assert.match(approvalDialog, /setFeedbackOpen\(true\)/);
  assert.match(approvalDialog, /reason: feedback\.trim\(\)/);
  assert.match(approvalDialog, /approvalFeedbackPlaceholder/);
  assert.match(approvalDialog, /evaluation\?\.failed/);
  assert.match(approvalDialog, /approvalEvaluationFailed/);
  assert.match(userInputDialog, /question\.allow_other/);
  assert.match(userInputDialog, /setCustomResponseOpen\(true\)/);
  assert.match(userInputDialog, /custom_response: customResponse\.trim\(\)/);
  assert.match(webServer, /custom_response: customResponse/);
  assert.match(appContext, /\{ requestId: id, \.\.\.payload \}/);
  const agentLoop = source('src/core/agent-loop.js');
  assert.match(agentLoop, /approvalReason = approved \? '' : String\(decision\?\.reason/);
  assert.match(agentLoop, /buildApprovalBlockedResult\(toolName, effectiveArgs, approvalState\.reason\)/);
});
