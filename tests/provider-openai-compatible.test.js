import assert from 'node:assert/strict';
import test from 'node:test';

import { createChatCompletionStream } from '../src/core/provider/openai-compatible.js';

test('Kimi streaming completion returns usage nested on the final choice', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => new Response([
    'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}',
    '',
    'data: {"choices":[{"delta":{},"finish_reason":"stop","usage":{"prompt_tokens":19,"completion_tokens":13,"total_tokens":32,"cached_tokens":10}}]}',
    '',
    'data: [DONE]',
    ''
  ].join('\n'), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  });

  const result = await createChatCompletionStream({
    baseUrl: 'https://api.moonshot.ai/v1',
    apiKey: 'test-key',
    model: 'kimi-k2.6',
    messages: [{ role: 'user', content: 'Hello' }],
    maxRetries: 0
  });

  assert.equal(result.text, 'Hello');
  assert.deepEqual(result.usage, {
    prompt_tokens: 19,
    completion_tokens: 13,
    total_tokens: 32,
    cached_tokens: 10
  });
});
