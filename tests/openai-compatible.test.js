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

function makeCrlfSseResponse(events) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\r\n\r\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\r\n\r\n'));
      controller.close();
    }
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' }
  });
}

test('package.json does not require provider SDK dependencies for transport', () => {
  assert.equal('openai' in (pkg.dependencies || {}), false);
  assert.equal('@anthropic-ai/sdk' in (pkg.dependencies || {}), false);
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

test('MiniMax payload keeps leading system message and rewrites later system history entries as user notes', async () => {
  const restoreFetch = withMockFetch(async (_url, init) => {
    const body = JSON.parse(typeof init.body === 'string' ? init.body : String(init.body));
    assert.deepEqual(body.messages, [
      { role: 'system', content: 'top system prompt' },
      { role: 'user', content: 'hello' },
      { role: 'user', content: '[system-note]\nlocal command output' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: '[system-note]\nanother local note' },
      { role: 'user', content: 'next question' }
    ]);
    return makeJsonResponse({
      choices: [
        {
          message: {
            content: 'ok'
          }
        }
      ]
    });
  });

  try {
    const result = await createChatCompletion({
      baseUrl: 'https://gateway.example/v1',
      apiKey: 'test-key',
      model: 'minimax',
      messages: [
        { role: 'system', content: 'top system prompt' },
        { role: 'user', content: 'hello' },
        { role: 'system', content: 'local command output' },
        { role: 'assistant', content: 'hi' },
        { role: 'system', content: 'another local note' },
        { role: 'user', content: 'next question' }
      ]
    });

    assert.equal(result.text, 'ok');
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

test('createChatCompletionStream normalizes object-shaped streamed tool arguments', async () => {
  const restoreFetch = withMockFetch(async (_url, _init) => {
    return makeSseResponse([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_stream_obj',
                  function: { name: 'write', arguments: { file: 'notes.txt', text: 'hello' } }
                }
              ]
            }
          }
        ]
      }
    ]);
  });

  try {
    const result = await createChatCompletionStream({
      baseUrl: 'https://gateway.example/v1',
      apiKey: 'test-key',
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: 'stream please' }]
    });

    assert.deepEqual(result.toolCalls, [
      {
        id: 'call_stream_obj',
        name: 'write',
        arguments: '{"file":"notes.txt","text":"hello"}'
      }
    ]);
  } finally {
    await restoreFetch();
  }
});

test('createChatCompletionStream marks empty post-tool responses as incomplete instead of final', async () => {
  const restoreFetch = withMockFetch(async (_url, _init) => {
    return makeSseResponse([
      {
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 }
      }
    ]);
  });

  try {
    const result = await createChatCompletionStream({
      baseUrl: 'https://gateway.example/v1',
      apiKey: 'test-key',
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'call_1', content: 'file contents' }
      ]
    });

    assert.equal(result.text, '');
    assert.deepEqual(result.toolCalls, []);
    assert.equal(result.incomplete, true);
    assert.deepEqual(result.usage, { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 });
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

test('createChatCompletion normalizes object-shaped tool call arguments from gateways', async () => {
  const restoreFetch = withMockFetch(async (_url, _init) => {
    return makeJsonResponse({
      choices: [
        {
          message: {
            content: 'ok',
            tool_calls: [
              {
                id: 'call_obj_1',
                function: {
                  name: 'read',
                  arguments: { file_path: 'src/app.ts', offset: 5, limit: 10 }
                }
              }
            ]
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

    assert.deepEqual(result.toolCalls, [
      {
        id: 'call_obj_1',
        name: 'read',
        arguments: '{"file_path":"src/app.ts","offset":5,"limit":10}'
      }
    ]);
  } finally {
    await restoreFetch();
  }
});

test('createChatCompletion sanitizes invalid historical tool call arguments before sending', async () => {
  const restoreFetch = withMockFetch(async (_url, init) => {
    const body = JSON.parse(typeof init.body === 'string' ? init.body : String(init.body));
    assert.equal(
      body.messages[1].tool_calls[0].function.arguments,
      '{}',
      'expected invalid tool call arguments to be normalized for gateway compatibility'
    );
    return makeJsonResponse({
      choices: [
        {
          message: {
            content: 'recovered'
          }
        }
      ]
    });
  });

  try {
    const result = await createChatCompletion({
      baseUrl: 'https://gateway.example/v1',
      apiKey: 'test-key',
      model: 'Qwen/Qwen3-Coder-30B-A3B-Instruct',
      messages: [
        { role: 'user', content: 'Use the edit tool.' },
        {
          role: 'assistant',
          content: 'Let me try.',
          tool_calls: [
            {
              id: 'call_bad_1',
              type: 'function',
              function: {
                name: 'edit',
                arguments: '.'
              }
            }
          ]
        },
        {
          role: 'tool',
          tool_call_id: 'call_bad_1',
          content: '{"error":"edit requires file and edit.kind"}'
        }
      ],
      tools: [{ type: 'function', function: { name: 'edit', parameters: { type: 'object' } } }]
    });

    assert.equal(result.text, 'recovered');
  } finally {
    await restoreFetch();
  }
});

test('createChatCompletionStream tolerates an empty post-tool assistant turn', async () => {
  const restoreFetch = withMockFetch(async (_url, _init) => {
    return makeSseResponse([
      {
        choices: [
          {
            delta: {},
            finish_reason: 'stop'
          }
        ],
        usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 }
      }
    ]);
  });

  try {
    const result = await createChatCompletionStream({
      baseUrl: 'https://gateway.example/v1',
      apiKey: 'test-key',
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'user', content: 'inspect auth flow' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"path":"src/auth.ts"}' } }] },
        { role: 'tool', tool_call_id: 'call_1', content: '[File: src/auth.ts]\nexport const auth = true;' }
      ]
    });

    assert.equal(result.text, '');
    assert.deepEqual(result.toolCalls, []);
    assert.equal(result.incomplete, true);
    assert.deepEqual(result.usage, { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 });
  } finally {
    await restoreFetch();
  }
});

test('createChatCompletionStream marks whitespace-only post-tool responses as incomplete', async () => {
  const restoreFetch = withMockFetch(async (_url, _init) => {
    return makeSseResponse([
      {
        choices: [
          {
            delta: { content: '   \n\n' },
            finish_reason: 'stop'
          }
        ],
        usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 }
      }
    ]);
  });

  try {
    const result = await createChatCompletionStream({
      baseUrl: 'https://gateway.example/v1',
      apiKey: 'test-key',
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'call_1', content: 'file contents' }
      ]
    });

    assert.equal(result.text, '');
    assert.deepEqual(result.toolCalls, []);
    assert.equal(result.incomplete, true);
  } finally {
    await restoreFetch();
  }
});

test('createChatCompletionStream handles CRLF-delimited SSE frames from gateways', async () => {
  const restoreFetch = withMockFetch(async (_url, _init) => {
    return makeCrlfSseResponse([
      {
        choices: [
          {
            delta: { content: 'hello ' }
          }
        ]
      },
      {
        choices: [
          {
            delta: { content: 'world' },
            finish_reason: 'stop'
          }
        ],
        usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 }
      }
    ]);
  });

  try {
    const result = await createChatCompletionStream({
      baseUrl: 'https://gateway.example/v1',
      apiKey: 'test-key',
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: 'hello' }]
    });

    assert.equal(result.text, 'hello world');
    assert.deepEqual(result.usage, { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 });
  } finally {
    await restoreFetch();
  }
});
