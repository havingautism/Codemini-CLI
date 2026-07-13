import test from 'node:test';
import assert from 'node:assert/strict';

import { createChatCompletion } from '../src/core/provider/anthropic.js';

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
