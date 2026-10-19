import assert from 'node:assert/strict';
import test from 'node:test';

import { createChatCompletion, createChatCompletionStream } from '../src/core/provider/openai-compatible.js';
import { runAgentLoop } from '../src/core/agent-loop.js';
import { createToolRuntime } from '../src/core/tool-runtime.js';

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

  let preparedPayload = null;
  const result = await createChatCompletionStream({
    baseUrl: 'https://api.moonshot.ai/v1',
    apiKey: 'test-key',
    model: 'kimi-k2.6',
    messages: [{ role: 'user', content: 'Hello' }],
    maxRetries: 0,
    onPayloadPrepared: (payload) => { preparedPayload = payload; },
  });

  assert.equal(result.text, 'Hello');
  assert.deepEqual(result.usage, {
    prompt_tokens: 19,
    completion_tokens: 13,
    total_tokens: 32,
    cached_tokens: 10
  });
  assert.equal(preparedPayload.stream, true);
  assert.equal(preparedPayload.messages[0].content, 'Hello');
});

test('OpenAI-compatible stream treats EOF without finish_reason as incomplete tool arguments', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => new Response([
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"write","arguments":"{\\"path\\":\\"a.txt\\",\\"content\\":\\"complete-looking\\"}"}}]},"finish_reason":null}]}',
    '',
  ].join('\n'), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });

  const result = await createChatCompletionStream({
    baseUrl: 'https://example.invalid/v1',
    apiKey: 'test-key',
    model: 'test-model',
    messages: [{ role: 'user', content: 'write it' }],
    maxRetries: 0,
  });

  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].argumentsComplete, false);
  assert.doesNotThrow(() => JSON.parse(result.toolCalls[0].arguments));
});

test('OpenAI-compatible stream does not authorize tools from [DONE] alone', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => new Response([
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"write","arguments":"{\\"path\\":\\"a.txt\\",\\"content\\":\\"ok\\"}"}}]},"finish_reason":null}]}',
    '',
    'data: [DONE]',
    '',
  ].join('\n'), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });

  const result = await createChatCompletionStream({
    baseUrl: 'https://example.invalid/v1',
    apiKey: 'test-key',
    model: 'test-model',
    messages: [{ role: 'user', content: 'write it' }],
    maxRetries: 0,
  });

  assert.equal(result.toolCalls[0].argumentsComplete, false);
});

test('OpenAI-compatible stream requires message and stream completion before tool dispatch', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const fixtures = [
    { name: 'tool_calls and DONE', reason: 'tool_calls', done: true, executable: true },
    { name: 'compatible stop and DONE', reason: 'stop', done: true, executable: true },
    { name: 'legacy function_call and DONE', reason: 'function_call', done: true, executable: true },
    { name: 'EOF after tool_calls', reason: 'tool_calls' },
    { name: 'EOF before both terminal markers' },
    { name: 'DONE without finish_reason', done: true },
    { name: 'DONE with empty finish_reason', reason: '', done: true },
    { name: 'DONE with whitespace finish_reason', reason: ' ', done: true },
    { name: 'content_filter and DONE', reason: 'content_filter', done: true },
    { name: 'unknown finish_reason and DONE', reason: 'unknown', done: true },
    { name: 'length and DONE', reason: 'length', done: true },
    { name: 'max_tokens and DONE', reason: 'max_tokens', done: true },
    { name: 'length without DONE', reason: 'length' },
    { name: 'invalid JSON despite terminal markers', reason: 'tool_calls', done: true, raw: '{"value":' },
  ];
  for (const fixture of fixtures) {
    await t.test(fixture.name, async () => {
      const raw = fixture.raw ?? '{"value":"ok"}';
      const chunks = [
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'counter', arguments: raw } }] }, finish_reason: null }] },
      ];
      if (fixture.reason !== undefined) chunks.push({ choices: [{ index: 0, delta: {}, finish_reason: fixture.reason }] });
      // Usage arrives after the choice terminates and must still be collected.
      chunks.push({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
      const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')
        + (fixture.done ? 'data: [DONE]\n\n' : '');
      globalThis.fetch = async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } });
      let effects = 0;
      const runtime = createToolRuntime({
        definitions: [{ type: 'function', function: { name: 'counter', parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } } }],
        handlers: { counter: async () => { effects += 1; return { ok: true }; } },
      });
      const result = await createChatCompletionStream({
        baseUrl: 'https://example.invalid/v1', apiKey: 'test-key', model: 'test-model',
        messages: [{ role: 'user', content: 'count once' }], tools: runtime.definitions(), maxRetries: 0,
      });
      assert.equal(result.toolCalls.length, 1);
      assert.equal(result.toolCalls[0].arguments, raw);
      const completed = ['tool_calls', 'stop', 'function_call'].includes(fixture.reason) && fixture.done === true;
      assert.equal(result.toolCalls[0].argumentsComplete, completed);
      assert.equal(result.usage.total_tokens, 15);
      let requests = 0;
      const loopResult = await runAgentLoop({
        systemPrompt: 'test', userPrompt: 'count once', model: 'test-model',
        toolRuntime: runtime, approvalMode: 'full_access', skipAnalysisNudge: true,
        config: { memory: { enabled: false } },
        requestCompletion: async () => ++requests === 1 ? result : { text: 'done', toolCalls: [] },
      });
      assert.equal(loopResult.text, 'done');
      assert.equal(effects, fixture.executable ? 1 : 0);
      if (!fixture.executable) assert.equal(runtime.beginModelResponse(result.toolCalls).calls[0].args._invalid_json, true);
    });
  }
});

test('OpenAI-compatible non-stream tool calls require a successful finish reason', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  for (const reason of ['tool_calls', 'stop', 'function_call', undefined, '', ' ', 'length', 'max_tokens', 'content_filter', 'unknown']) {
    await t.test(`finish_reason: ${JSON.stringify(reason)}`, async () => {
      globalThis.fetch = async () => Response.json({ choices: [{
        message: { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'counter', arguments: '{"value":"ok"}' } }] },
        finish_reason: reason,
      }] });
      const result = await createChatCompletion({
        baseUrl: 'https://example.invalid/v1', apiKey: 'test-key', model: 'test-model',
        messages: [{ role: 'user', content: 'count once' }], maxRetries: 0,
      });
      assert.equal(result.toolCalls.length, 1);
      assert.equal(result.toolCalls[0].argumentsComplete, ['tool_calls', 'stop', 'function_call'].includes(reason));
    });
  }
});
