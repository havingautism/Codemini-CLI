import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createChatRuntime } from '../src/core/chat-runtime.js';
import { loadConfig } from '../src/core/config-store.js';

async function withTempConfigDir(run) {
  const prev = process.env.CODEMINI_CONFIG_DIR;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-config-'));
  process.env.CODEMINI_CONFIG_DIR = dir;
  try {
    await run(dir);
  } finally {
    if (prev === undefined) {
      delete process.env.CODEMINI_CONFIG_DIR;
    } else {
      process.env.CODEMINI_CONFIG_DIR = prev;
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function withMockFetch(handler) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  return async () => {
    globalThis.fetch = originalFetch;
  };
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

test('chat runtime reflects config and mode changes immediately for TUI refresh', async () => {
  await withTempConfigDir(async () => {
    const config = await loadConfig();
    const now = new Date().toISOString();
    const runtime = await createChatRuntime({
      session: {
        id: 'session-config-refresh',
        createdAt: now,
        updatedAt: now,
        messages: []
      },
      config,
      systemPrompt: 'You are a test assistant.'
    });

    assert.deepEqual(runtime.getRuntimeState(), {
      sessionId: 'session-config-refresh',
      mode: 'auto',
      model: 'gpt-4.1-mini',
      maxContextTokens: 202752
    });

    await runtime.submit('/config set model.name minimax');
    assert.deepEqual(runtime.getRuntimeState(), {
      sessionId: 'session-config-refresh',
      mode: 'auto',
      model: 'minimax',
      maxContextTokens: 202752
    });

    await runtime.submit('/config set model.max_context_tokens 12345');
    assert.deepEqual(runtime.getRuntimeState(), {
      sessionId: 'session-config-refresh',
      mode: 'auto',
      model: 'minimax',
      maxContextTokens: 12345
    });

    await runtime.submit('/mode plan');
    assert.deepEqual(runtime.getRuntimeState(), {
      sessionId: 'session-config-refresh',
      mode: 'plan',
      model: 'minimax',
      maxContextTokens: 12345
    });
  });
});

test('chat runtime emits skill lifecycle events for explicit skill commands', async () => {
  await withTempConfigDir(async () => {
    const restoreFetch = withMockFetch(async () =>
      makeSseResponse([
        { choices: [{ delta: { content: 'skill output' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] }
      ])
    );

    try {
      const config = await loadConfig();
      config.gateway.base_url = 'https://gateway.example/v1';
      config.gateway.api_key = 'test-key';

      const now = new Date().toISOString();
      const runtime = await createChatRuntime({
        session: {
          id: 'session-skill-events',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const events = [];
      const result = await runtime.submit('/superpowers-lite', (event) => events.push(event));

      assert.equal(result.type, 'assistant');
      assert.equal(result.text, 'skill output');
      assert.ok(events.some((event) => event?.type === 'skill:start' && event?.name === 'superpowers-lite'));
      assert.ok(events.some((event) => event?.type === 'skill:end' && event?.name === 'superpowers-lite'));
    } finally {
      await restoreFetch();
    }
  });
});
