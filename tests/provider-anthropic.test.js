import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createChatCompletion,
  createChatCompletionStream,
} from '../src/core/provider/anthropic.js';

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

  const result = await createChatCompletion({
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: 'test-key',
    model: 'deepseek-v4-flash',
    messages: [{ role: 'user', content: 'title' }],
    reasoningEffort: 'off',
    maxTokens: 256,
  });

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

test('Anthropic stream marks tool arguments complete after content_block_stop', async (t) => {
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
