import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createChatCompletion,
  createChatCompletionStream,
} from '../src/core/provider/anthropic.js';
import { createToolRuntime } from '../src/core/tool-runtime.js';
import { runAgentLoop } from '../src/core/agent-loop.js';

test('Anthropic DeepSeek completion explicitly disables thinking when requested', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let requestBody = null;
  globalThis.fetch = async (_url, options = {}) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      content: [{ type: 'text', text: '🧪 Plan 工具注释测试' }],
      usage: { input_tokens: 10, output_tokens: 8 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  let preparedPayload = null;
  const result = await createChatCompletion({
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: 'test-key',
    model: 'deepseek-v4-flash',
    messages: [{ role: 'user', content: 'title' }],
    reasoningEffort: 'off',
    maxTokens: 256,
    onPayloadPrepared: (payload) => { preparedPayload = payload; },
  });

  assert.deepEqual(preparedPayload, requestBody);
  assert.deepEqual(requestBody.thinking, { type: 'disabled' });
  assert.equal(requestBody.max_tokens, 256);
  assert.equal(result.text, '🧪 Plan 工具注释测试');
});

test('Anthropic DeepSeek adaptation follows prefixed model names across gateways', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let requestBody = null;
  globalThis.fetch = async (_url, options = {}) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      content: [{ type: 'text', text: '💬 Gateway title' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  await createChatCompletion({
    baseUrl: 'https://example.invalid/anthropic',
    apiKey: 'test-key',
    model: 'deepseek/deepseek-v4-flash',
    messages: [{ role: 'user', content: 'title' }],
    reasoningEffort: 'off',
    maxTokens: 256,
  });

  assert.deepEqual(requestBody.thinking, { type: 'disabled' });
});

test('Anthropic non-stream completion forwards an external abort signal', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const controller = new AbortController();
  controller.abort(new Error('title task disposed'));
  let receivedSignal = null;
  globalThis.fetch = async (_url, options = {}) => {
    receivedSignal = options.signal;
    throw options.signal?.reason || new Error('request was not aborted');
  };

  await assert.rejects(
    createChatCompletion({
      baseUrl: 'https://example.invalid',
      apiKey: 'test-key',
      model: 'test-model',
      messages: [{ role: 'user', content: 'title' }],
      signal: controller.signal,
    }),
    /title task disposed/,
  );
  assert.equal(receivedSignal?.aborted, true);
});

test('Anthropic stream requires content_block_stop before tool arguments are executable', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const streamBody = [
    'event: content_block_start',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool-1","name":"write","input":{}}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"a.txt\\",\\"content\\":\\"complete-looking\\"}"}}',
    '',
    'event: message_delta',
    'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}',
    '',
    'event: message_stop',
    'data: {"type":"message_stop"}',
    '',
  ].join('\r\n');
  globalThis.fetch = async () => new Response(streamBody, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });

  const result = await createChatCompletionStream({
    baseUrl: 'https://example.invalid',
    apiKey: 'test-key',
    model: 'test-model',
    messages: [{ role: 'user', content: 'write it' }],
    tools: [{
      type: 'function',
      function: { name: 'write', parameters: { type: 'object' } },
    }],
  });

  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].argumentsComplete, false);
  assert.doesNotThrow(() => JSON.parse(result.toolCalls[0].arguments));
});

test('Anthropic stream marks tool arguments complete after block and message completion', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const streamBody = [
    'event: content_block_start',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool-1","name":"write","input":{}}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"a.txt\\",\\"content\\":\\"ok\\"}"}}',
    '',
    'event: content_block_stop',
    'data: {"type":"content_block_stop","index":0}',
    '',
    'event: message_delta',
    'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}',
    '',
    'event: message_stop',
    'data: {"type":"message_stop"}',
    '',
  ].join('\n');
  globalThis.fetch = async () => new Response(streamBody, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });

  const result = await createChatCompletionStream({
    baseUrl: 'https://example.invalid',
    apiKey: 'test-key',
    model: 'test-model',
    messages: [{ role: 'user', content: 'write it' }],
  });

  assert.equal(result.toolCalls[0].argumentsComplete, true);
});

test('Anthropic stream requires positive message completion before tool dispatch', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const fixtures = [
    { name: 'complete message', blockStop: true, reason: 'tool_use', messageStop: true, executable: true },
    { name: 'EOF before message_stop', blockStop: true, reason: 'tool_use' },
    { name: 'EOF before both message terminal events', blockStop: true },
    { name: 'message_stop without stop reason', blockStop: true, messageStop: true },
    { name: 'message_stop with empty stop reason', blockStop: true, reason: '', messageStop: true },
    { name: 'message_stop before tool block closes', reason: 'tool_use', messageStop: true },
    { name: 'max_tokens with complete JSON', blockStop: true, reason: 'max_tokens', messageStop: true },
    { name: 'length with complete JSON', blockStop: true, reason: 'length', messageStop: true },
    { name: 'gateway DONE without message_stop', blockStop: true, reason: 'tool_use', done: true },
  ];
  for (const fixture of fixtures) {
    await t.test(fixture.name, async () => {
      const events = [
        { type: 'message_start', message: { usage: { input_tokens: 10 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool-1', name: 'counter', input: {} } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"value":"ok"}' } },
      ];
      if (fixture.blockStop) events.push({ type: 'content_block_stop', index: 0 });
      if (fixture.reason !== undefined) events.push({ type: 'message_delta', delta: { stop_reason: fixture.reason }, usage: { output_tokens: 5 } });
      if (fixture.messageStop) events.push({ type: 'message_stop' });
      const streamBody = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
        + (fixture.done ? 'data: [DONE]\n\n' : '');
      globalThis.fetch = async () => new Response(streamBody, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
      let effects = 0;
      const runtime = createToolRuntime({
        definitions: [{ type: 'function', function: { name: 'counter', parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } } }],
        handlers: { counter: async () => { effects += 1; } },
      });
      const result = await createChatCompletionStream({
        baseUrl: 'https://example.invalid', apiKey: 'test-key', model: 'test-model',
        messages: [{ role: 'user', content: 'count once' }], tools: runtime.definitions(),
      });
      assert.equal(result.toolCalls.length, 1);
      assert.equal(result.toolCalls[0].argumentsComplete, fixture.executable === true);
      assert.deepEqual(JSON.parse(result.toolCalls[0].arguments), { value: 'ok' });
      assert.equal(result.usage.input_tokens, 10);
      const response = runtime.beginModelResponse(result.toolCalls);
      let requests = 0;
      const loopResult = await runAgentLoop({
        systemPrompt: 'test', userPrompt: 'count once', model: 'test-model',
        toolRuntime: runtime, approvalMode: 'full_access', skipAnalysisNudge: true,
        config: { memory: { enabled: false } },
        requestCompletion: async () => ++requests === 1 ? result : { text: 'done', toolCalls: [] },
      });
      assert.equal(loopResult.text, 'done');
      assert.equal(effects, fixture.executable ? 1 : 0);
      if (!fixture.executable) {
        assert.equal(response.calls[0].args._invalid_json, true);
        assert.equal(response.calls[0].args._truncated, true);
      }
    });
  }
});

test('Anthropic tool results preserve explicit error status', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let requestBody = null;
  globalThis.fetch = async (_url, options = {}) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      content: [{ type: 'text', text: 'retrying safely' }],
      stop_reason: 'end_turn',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  await createChatCompletion({
    baseUrl: 'https://example.invalid',
    apiKey: 'test-key',
    model: 'test-model',
    messages: [
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'tool-1',
          type: 'function',
          function: { name: 'write', arguments: '{}' },
        }],
      },
      {
        role: 'tool',
        tool_call_id: 'tool-1',
        content: '{"error":"Truncated tool arguments for write"}',
        tool_status: 'error',
      },
    ],
  });

  const resultBlock = requestBody.messages[1].content[0];
  assert.equal(resultBlock.type, 'tool_result');
  assert.equal(resultBlock.is_error, true);
});
