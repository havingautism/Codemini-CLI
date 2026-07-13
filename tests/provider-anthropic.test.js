import test from 'node:test';
import assert from 'node:assert/strict';

import { createChatCompletion } from '../src/core/provider/anthropic.js';

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
