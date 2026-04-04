import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createChatCompletion,
  createChatCompletionStream
} from '../src/core/provider/index.js';

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

function makeAnthropicSseResponse(events) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(
          encoder.encode(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`)
        );
      }
      controller.close();
    }
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' }
  });
}

test('provider routes anthropic requests through messages API with tool conversion', async () => {
  const restoreFetch = withMockFetch(async (url, init) => {
    assert.equal(url, 'https://gateway.example/anthropic/v1/messages');
    assert.equal(init.method, 'POST');

    const headers = new Headers(init.headers);
    assert.equal(headers.get('x-api-key'), 'test-key');
    assert.equal(headers.get('anthropic-version'), '2023-06-01');

    const body = JSON.parse(typeof init.body === 'string' ? init.body : String(init.body));
    assert.equal(body.model, 'MiniMax-M2.7');
    assert.equal(body.max_tokens, 4096);
    assert.equal(body.temperature, 0.2);
    assert.deepEqual(body.system, 'be helpful');
    assert.deepEqual(body.tool_choice, { type: 'auto' });
    assert.deepEqual(body.tools, [
      {
        name: 'search_docs',
        description: 'Search docs',
        input_schema: { type: 'object', properties: { q: { type: 'string' } } }
      }
    ]);
    assert.deepEqual(body.messages, [
      {
        role: 'user',
        content: [{ type: 'text', text: 'hello' }]
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'let me check' },
          { type: 'tool_use', id: 'call_1', name: 'search_docs', input: { q: 'sdk' } }
        ]
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'docs result' }]
      }
    ]);

    return makeJsonResponse({
      content: [
        { type: 'thinking', thinking: 'internal' },
        { type: 'text', text: 'done' },
        { type: 'tool_use', id: 'call_2', name: 'read_file', input: { path: 'README.md' } }
      ],
      usage: { input_tokens: 11, output_tokens: 7 }
    });
  });

  try {
    const result = await createChatCompletion({
      sdkProvider: 'anthropic',
      baseUrl: 'https://gateway.example/anthropic',
      apiKey: 'test-key',
      model: 'MiniMax-M2.7',
      messages: [
        { role: 'system', content: 'be helpful' },
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          content: 'let me check',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'search_docs', arguments: '{"q":"sdk"}' }
            }
          ]
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'docs result' }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'search_docs',
            description: 'Search docs',
            parameters: { type: 'object', properties: { q: { type: 'string' } } }
          }
        }
      ]
    });

    assert.equal(result.text, 'done');
    assert.deepEqual(result.toolCalls, [
      { id: 'call_2', name: 'read_file', arguments: '{"path":"README.md"}' }
    ]);
    assert.deepEqual(result.usage, { input_tokens: 11, output_tokens: 7 });
    assert.deepEqual(result.content, [
      { type: 'thinking', thinking: 'internal' },
      { type: 'text', text: 'done' },
      { type: 'tool_use', id: 'call_2', name: 'read_file', input: { path: 'README.md' } }
    ]);
  } finally {
    await restoreFetch();
  }
});

test('provider streams anthropic text and tool deltas', async () => {
  const restoreFetch = withMockFetch(async (url, init) => {
    assert.equal(url, 'https://gateway.example/anthropic/v1/messages');
    const body = JSON.parse(typeof init.body === 'string' ? init.body : String(init.body));
    assert.equal(body.stream, true);

    return makeAnthropicSseResponse([
      {
        event: 'message_start',
        data: { message: { usage: { input_tokens: 3, output_tokens: 0 } } }
      },
      {
        event: 'content_block_start',
        data: { index: 0, content_block: { type: 'text', text: '' } }
      },
      {
        event: 'content_block_delta',
        data: { index: 0, delta: { type: 'text_delta', text: 'hello ' } }
      },
      {
        event: 'content_block_start',
        data: {
          index: 1,
          content_block: { type: 'tool_use', id: 'call_9', name: 'lookup', input: {} }
        }
      },
      {
        event: 'content_block_delta',
        data: { index: 1, delta: { type: 'input_json_delta', partial_json: '{"a":' } }
      },
      {
        event: 'content_block_delta',
        data: { index: 1, delta: { type: 'input_json_delta', partial_json: '"b"}' } }
      },
      {
        event: 'content_block_delta',
        data: { index: 0, delta: { type: 'text_delta', text: 'world' } }
      },
      {
        event: 'message_delta',
        data: { usage: { output_tokens: 4 } }
      },
      {
        event: 'message_stop',
        data: {}
      }
    ]);
  });

  const deltas = [];
  try {
    const result = await createChatCompletionStream({
      sdkProvider: 'anthropic',
      baseUrl: 'https://gateway.example/anthropic',
      apiKey: 'test-key',
      model: 'MiniMax-M2.7',
      messages: [{ role: 'user', content: 'stream please' }],
      tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }],
      onTextDelta: (chunk) => deltas.push(chunk)
    });

    assert.deepEqual(deltas, ['hello ', 'world']);
    assert.equal(result.text, 'hello world');
    assert.deepEqual(result.toolCalls, [
      { id: 'call_9', name: 'lookup', arguments: '{"a":"b"}' }
    ]);
    assert.deepEqual(result.usage, { input_tokens: 3, output_tokens: 4 });
  } finally {
    await restoreFetch();
  }
});
