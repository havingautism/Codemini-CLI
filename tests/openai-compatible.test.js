import test from 'node:test';
import assert from 'node:assert/strict';

import { createChatCompletion, createChatCompletionStream } from '../src/core/provider/openai-compatible.js';
import pkg from '../package.json' with { type: 'json' };

function withMockFetch(handler) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  return async () => {
    globalThis.fetch = originalFetch;
  };
}

function makeJsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

function makeSseResponse(events) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    }
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' }
  });
}

test('package.json declares openai dependency for provider transport', () => {
  assert.ok(pkg.dependencies?.openai, 'expected package.json to include openai dependency');
});

test('createChatCompletion returns text and tool calls from an OpenAI-compatible gateway', async () => {
  const restoreFetch = withMockFetch(async (url, init) => {
    assert.equal(url, 'https://gateway.example/v1/chat/completions');
    assert.equal(init.method, 'POST');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('authorization'), 'Bearer test-key');
    const body = JSON.parse(typeof init.body === 'string' ? init.body : String(init.body));
    assert.equal(body.model, 'minimax');
    assert.equal(body.temperature, 0.2);
    assert.deepEqual(body.messages, [{ role: 'user', content: 'hello' }]);
    assert.equal(body.tool_choice, 'auto');
    assert.deepEqual(body.extra_body, { reasoning_split: true });

    return makeJsonResponse({
      choices: [
        {
          message: {
            content: '<think>internal reasoning</think>\n\nhello from gateway',
            tool_calls: [
              {
                id: 'call_1',
                function: {
                  name: 'search_docs',
                  arguments: '{"q":"sdk"}'
                }
              }
            ]
          }
        }
      ],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }
    });
  });

  try {
    const result = await createChatCompletion({
      baseUrl: 'https://gateway.example/v1',
      apiKey: 'test-key',
      model: 'minimax',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{ type: 'function', function: { name: 'search_docs', parameters: { type: 'object' } } }]
    });

    assert.equal(result.text, 'hello from gateway');
    assert.deepEqual(result.toolCalls, [
      { id: 'call_1', name: 'search_docs', arguments: '{"q":"sdk"}' }
    ]);
    assert.deepEqual(result.usage, { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 });
  } finally {
    await restoreFetch();
  }
});

test('createChatCompletionStream emits text deltas and final tool calls from SSE gateway', async () => {
  const restoreFetch = withMockFetch(async (_url, init) => {
    const body = JSON.parse(typeof init.body === 'string' ? init.body : String(init.body));
    assert.equal(body.stream, true);
    assert.deepEqual(body.extra_body, { reasoning_split: true });

    return makeSseResponse([
      {
        choices: [{ delta: { content: '<think>internal' } }]
      },
      {
        choices: [
          {
            delta: {
              content: '<think>internal reasoning</think>\n\nhello ',
              tool_calls: [
                {
                  index: 0,
                  id: 'call_9',
                  function: { name: 'lookup', arguments: '{"a":' }
                }
              ]
            }
          }
        ]
      },
      {
        choices: [
          {
            delta: {
              content: '<think>internal reasoning</think>\n\nhello world',
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: '"b"}' }
                }
              ]
            },
            finish_reason: 'stop'
          }
        ],
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 }
      }
    ]);
  });

  const deltas = [];
  try {
    const result = await createChatCompletionStream({
      baseUrl: 'https://gateway.example/v1',
      apiKey: 'test-key',
      model: 'minimax',
      messages: [{ role: 'user', content: 'stream please' }],
      tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }],
      onTextDelta: (chunk) => deltas.push(chunk)
    });

    assert.deepEqual(deltas, ['hello ', 'world']);
    assert.equal(result.text, 'hello world');
    assert.deepEqual(result.toolCalls, [
      { id: 'call_9', name: 'lookup', arguments: '{"a":"b"}' }
    ]);
    assert.deepEqual(result.usage, { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 });
  } finally {
    await restoreFetch();
  }
});

test('createChatCompletion does not send MiniMax-only extra_body for other providers', async () => {
  const restoreFetch = withMockFetch(async (_url, init) => {
    const body = JSON.parse(typeof init.body === 'string' ? init.body : String(init.body));
    assert.equal(body.model, 'gpt-4.1-mini');
    assert.equal('extra_body' in body, false);
    return makeJsonResponse({
      choices: [
        {
          message: {
            content: 'plain response'
          }
        }
      ]
    });
  });

  try {
    const result = await createChatCompletion({
      baseUrl: 'https://gateway.example/v1',
      apiKey: 'test-key',
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: 'hello' }]
    });

    assert.equal(result.text, 'plain response');
    assert.deepEqual(result.toolCalls, []);
    assert.equal(result.usage, null);
  } finally {
    await restoreFetch();
  }
});
