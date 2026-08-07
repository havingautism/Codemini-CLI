import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentLoop } from '../src/core/agent-loop.js';
import { createToolRuntime } from '../src/core/tool-runtime.js';

function definition(name, parameters = { type: 'object', properties: {} }) {
  return {
    type: 'function',
    function: { name, description: `${name} tool`, parameters },
  };
}

test('agent loop accepts the ToolRuntime production seam without parallel tool maps', async () => {
  let requests = 0;
  let calls = 0;
  const toolRuntime = createToolRuntime({
    definitions: [definition('echo')],
    handlers: {
      echo: async () => {
        calls += 1;
        return { ok: true };
      },
    },
  });

  const result = await runAgentLoop({
    systemPrompt: 'test',
    userPrompt: 'call echo',
    model: 'test-model',
    toolRuntime,
    approvalMode: 'full_access',
    skipAnalysisNudge: true,
    config: { memory: { enabled: false } },
    requestCompletion: async ({ tools }) => {
      requests += 1;
      assert.deepEqual(tools.map((tool) => tool.function.name), ['echo']);
      return requests === 1
        ? { text: '', toolCalls: [{ id: 'echo-1', name: 'echo', arguments: '{}' }] }
        : { text: 'done', toolCalls: [] };
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.text, 'done');
});

test('agent loop enforces declared argument schemas before approval or execution', async () => {
  let requests = 0;
  let calls = 0;
  const result = await runAgentLoop({
    systemPrompt: 'test',
    userPrompt: 'call echo',
    model: 'test-model',
    toolDefinitions: [definition('echo', {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
    })],
    toolHandlers: {
      echo: async () => {
        calls += 1;
        return { ok: true };
      },
    },
    approvalMode: 'full_access',
    skipAnalysisNudge: true,
    config: { memory: { enabled: false } },
    requestCompletion: async () => {
      requests += 1;
      return requests === 1
        ? { text: '', toolCalls: [{ id: 'bad', name: 'echo', arguments: '{}' }] }
        : { text: 'recovered', toolCalls: [] };
    },
  });

  assert.equal(calls, 0);
  assert.equal(result.text, 'recovered');
  const rejected = result.messages.find((message) => message.tool_call_id === 'bad');
  assert.match(rejected.content, /Invalid arguments for echo/);
  assert.match(rejected.content, /value/i);
});

test('agent loop bounds parallel tool bodies, preserves result order, and passes the turn signal', async () => {
  const controller = new AbortController();
  let requests = 0;
  let running = 0;
  let peak = 0;
  const receivedSignals = [];
  const result = await runAgentLoop({
    systemPrompt: 'test',
    userPrompt: 'read several files',
    model: 'test-model',
    toolDefinitions: [definition('read', {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    })],
    toolHandlers: {
      read: async (args, context) => {
        receivedSignals.push(context.signal);
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 15));
        running -= 1;
        return { path: args.path };
      },
    },
    approvalMode: 'full_access',
    signal: controller.signal,
    skipAnalysisNudge: true,
    config: {
      memory: { enabled: false },
      tools: { max_parallel_calls: 2 },
    },
    requestCompletion: async () => {
      requests += 1;
      return requests === 1
        ? {
            text: '',
            toolCalls: Array.from({ length: 5 }, (_, index) => ({
              id: `read-${index}`,
              name: 'read',
              arguments: JSON.stringify({ path: `${index}.txt` }),
            })),
          }
        : { text: 'done', toolCalls: [] };
    },
  });

  assert.equal(peak, 2);
  assert.equal(receivedSignals.length, 5);
  assert.ok(receivedSignals.every((signal) => signal === controller.signal));
  assert.deepEqual(
    result.messages.filter((message) => message.role === 'tool').map((message) => message.tool_call_id),
    ['read-0', 'read-1', 'read-2', 'read-3', 'read-4'],
  );
});

test('model calls cannot bypass active tool visibility by guessing deferred or host-only names', async () => {
  let requests = 0;
  let deferredCalls = 0;
  let hostCalls = 0;
  const deferredEcho = definition('deferred_echo', {
    type: 'object',
    properties: { value: { type: 'string' } },
    required: ['value'],
  });
  const result = await runAgentLoop({
    systemPrompt: 'test',
    userPrompt: 'try hidden tools',
    model: 'test-model',
    toolDefinitions: [definition('tool_search', {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    })],
    deferredDefinitions: { deferred_echo: deferredEcho },
    toolHandlers: {
      tool_search: async () => ({ schemas: [deferredEcho] }),
      deferred_echo: async () => {
        deferredCalls += 1;
        return { ok: true };
      },
      host_only: async () => {
        hostCalls += 1;
        return { ok: true };
      },
    },
    approvalMode: 'full_access',
    skipAnalysisNudge: true,
    config: { memory: { enabled: false } },
    requestCompletion: async () => {
      requests += 1;
      if (requests === 1) {
        return {
          text: '',
          toolCalls: [
            { id: 'hidden-deferred', name: 'deferred_echo', arguments: '{"value":"x"}' },
            { id: 'hidden-host', name: 'host_only', arguments: '{}' },
          ],
        };
      }
      return { text: 'done', toolCalls: [] };
    },
  });

  assert.equal(deferredCalls, 0);
  assert.equal(hostCalls, 0);
  assert.equal(result.text, 'done');
  for (const id of ['hidden-deferred', 'hidden-host']) {
    const rejected = result.messages.find((message) => message.tool_call_id === id);
    assert.match(rejected.content, /not available in this model turn/);
  }
});

test('tool_search activation applies on the next model response', async () => {
  let requests = 0;
  let deferredCalls = 0;
  const deferredEcho = definition('deferred_echo', {
    type: 'object',
    properties: { value: { type: 'string' } },
    required: ['value'],
  });
  const result = await runAgentLoop({
    systemPrompt: 'test',
    userPrompt: 'load then call',
    model: 'test-model',
    toolDefinitions: [definition('tool_search', {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    })],
    deferredDefinitions: { deferred_echo: deferredEcho },
    toolHandlers: {
      tool_search: async () => ({ schemas: [deferredEcho] }),
      deferred_echo: async (args) => {
        deferredCalls += 1;
        return { value: args.value };
      },
    },
    approvalMode: 'full_access',
    skipAnalysisNudge: true,
    config: { memory: { enabled: false } },
    requestCompletion: async () => {
      requests += 1;
      if (requests === 1) {
        return { text: '', toolCalls: [{ id: 'search', name: 'tool_search', arguments: '{"query":"deferred_echo"}' }] };
      }
      if (requests === 2) {
        return { text: '', toolCalls: [{ id: 'echo', name: 'deferred_echo', arguments: '{"value":"ok"}' }] };
      }
      return { text: 'done', toolCalls: [] };
    },
  });

  assert.equal(deferredCalls, 1);
  assert.equal(result.text, 'done');
});
