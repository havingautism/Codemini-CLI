import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentLoop } from '../src/core/agent-loop.js';
import { createToolRuntime } from '../src/core/tool-runtime.js';

function definition(name, parameters = { type: 'object', properties: {} }) {
  return { type: 'function', function: { name, description: name, parameters } };
}

const base = {
  systemPrompt: 'system',
  userPrompt: 'task',
  model: 'test',
  approvalMode: 'full_access',
  skipAnalysisNudge: true,
  config: { memory: { enabled: false } },
};

test('external authority ask_user/escalate checkpoint without executing a model turn', async () => {
  let completions = 0;
  const events = [];
  const result = await runAgentLoop({
    ...base,
    decisionController: {
      enabled: true,
      mode: 'external_authority',
      evaluate: async () => ({ mode: 'external_authority', policy: { action: 'ask_user', reason: 'missing_information' } }),
    },
    onEvent: (event) => events.push(event),
    requestCompletion: async () => {
      completions += 1;
      return { text: 'must not run', toolCalls: [] };
    },
  });
  assert.equal(completions, 0);
  assert.equal(result.checkpoint, true);
  assert.equal(result.stopReason, 'external_ask_user');
  assert.ok(events.some((event) => event.type === 'checkpoint' && event.reason === 'external_ask_user'));
});

test('context selection is request-local and does not delete canonical history', async () => {
  let calls = 0;
  const seen = [];
  const result = await runAgentLoop({
    ...base,
    toolDefinitions: [definition('echo')],
    toolHandlers: { echo: async () => ({ ok: true }) },
    contextSelector: async ({ messages }) => messages.filter((message) => message.role !== 'tool'),
    requestCompletion: async ({ messages }) => {
      calls += 1;
      seen.push(messages.map((message) => message.role));
      return calls === 1
        ? { text: '', toolCalls: [{ id: 'echo-1', name: 'echo', arguments: '{}' }] }
        : { text: 'done', toolCalls: [] };
    },
  });
  assert.equal(result.text, 'done');
  assert.equal(seen[1].includes('tool'), false);
  assert.ok(result.messages.some((message) => message.role === 'tool'), 'canonical history must retain tool result');
});

test('skill route none blocks the skill call', async () => {
  let executed = 0;
  let calls = 0;
  const result = await runAgentLoop({
    ...base,
    toolDefinitions: [definition('skill', { type: 'object', properties: { name: { type: 'string' } } })],
    toolHandlers: { skill: async () => { executed += 1; return { ok: true }; } },
    skillRoute: async () => ({ choice: 'none', reason: 'no matching skill' }),
    requestCompletion: async () => {
      calls += 1;
      return calls === 1
        ? { text: '', toolCalls: [{ id: 'skill-1', name: 'skill', arguments: '{"name":"foo"}' }] }
        : { text: 'done', toolCalls: [] };
    },
  });
  assert.equal(executed, 0);
  assert.match(result.messages.find((message) => message.tool_call_id === 'skill-1').content, /selected none/);
});

test('tool result ok:false is an error and cannot count as verification', async () => {
  let calls = 0;
  const decisions = [];
  const result = await runAgentLoop({
    ...base,
    toolDefinitions: [definition('check')],
    toolHandlers: { check: async () => ({ ok: false, error: 'failed check' }) },
    decisionController: {
      enabled: true,
      mode: 'shadow',
      evaluate: async (input) => {
        decisions.push(input);
        return { mode: 'shadow', policy: { action: 'continue' } };
      },
    },
    requestCompletion: async () => {
      calls += 1;
      return calls === 1
        ? { text: '', toolCalls: [{ id: 'check-1', name: 'check', arguments: '{}' }] }
        : { text: 'done', toolCalls: [] };
    },
  });
  assert.equal(result.text, 'done');
  assert.equal(result.messages.find((message) => message.tool_call_id === 'check-1').tool_status, 'error');
  assert.equal(decisions[1].state.verificationPassed, false);
});

test('verification only comes from test exit code and is cleared by a later edit', async () => {
  let calls = 0;
  const decisions = [];
  const result = await runAgentLoop({
    ...base,
    toolDefinitions: [definition('run'), definition('edit')],
    toolHandlers: {
      run: async () => ({ code: 0, stdout: 'tests passed' }),
      edit: async () => ({ path: 'src/example.js', action: 'edit' }),
    },
    decisionController: {
      enabled: true,
      mode: 'shadow',
      evaluate: async (input) => {
        decisions.push(input);
        return { mode: 'shadow', policy: { action: 'continue' } };
      },
    },
    requestCompletion: async () => {
      calls += 1;
      if (calls === 1) return { text: '', toolCalls: [{ id: 'run-1', name: 'run', arguments: '{"command":"npm test"}' }] };
      if (calls === 2) return { text: '', toolCalls: [{ id: 'edit-1', name: 'edit', arguments: '{"path":"src/example.js"}' }] };
      return { text: 'done', toolCalls: [] };
    },
  });
  assert.equal(result.text, 'done');
  assert.equal(decisions[1].state.verificationPassed, true);
  assert.equal(decisions[2].state.verificationPassed, false);
});

test('completion review verify_more is bounded and checkpoints after two retries', async () => {
  let calls = 0;
  const result = await runAgentLoop({
    ...base,
    maxSteps: 20,
    completionReview: async () => ({ choice: 'verify_more', reason: 'verify required' }),
    requestCompletion: async () => {
      calls += 1;
      return { text: `summary-${calls}`, toolCalls: [] };
    },
  });
  assert.equal(result.checkpoint, true);
  assert.equal(result.stopReason, 'completion_review_limit');
  assert.equal(calls, 3);
});

test('guard review and confirm are routed through requestToolApproval', async () => {
  let approvals = 0;
  let executed = 0;
  let calls = 0;
  const result = await runAgentLoop({
    ...base,
    toolDefinitions: [definition('echo')],
    toolHandlers: { echo: async () => { executed += 1; return { ok: true }; } },
    toolGuard: async () => ({ action: 'confirm', reason: 'guard confirmation' }),
    requestToolApproval: async () => { approvals += 1; return { approved: true }; },
    requestCompletion: async () => {
      calls += 1;
      return calls === 1
        ? { text: '', toolCalls: [{ id: 'echo-1', name: 'echo', arguments: '{}' }] }
        : { text: 'done', toolCalls: [] };
    },
  });
  assert.equal(result.text, 'done');
  assert.equal(executed, 1);
  assert.ok(approvals >= 1);
});
