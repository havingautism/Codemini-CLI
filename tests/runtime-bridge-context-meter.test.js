import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createChatRuntime } from '../src/core/chat-runtime.js';
import { saveConfig } from '../src/core/config-store.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import { createSession } from '../src/core/session-store.js';
import { RuntimeBridge } from '../codemini-web/lib/runtime-bridge.js';

const sse = (payload) => `data: ${JSON.stringify(payload)}\n\n`;

test('Web CTX meter receives runtime:state after every assistant:response', async () => {
  closeSqliteDatabasesForTests();
  const previousDir = process.env.CODEMINI_GLOBAL_DIR;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-ctx-meter-'));
  process.env.CODEMINI_GLOBAL_DIR = dir;
  const originalFetch = globalThis.fetch;
  let bridge;
  try {
    const config = {
      sdk: { provider: 'openai-compatible' },
      gateway: { base_url: 'http://127.0.0.1:9/v1', api_key: 'test-key', timeout_ms: 5000, max_retries: 0 },
      model: { name: 'test-model', fast_name: 'test-model', reasoning_enabled: false, reasoning_effort: 'off', max_context_tokens: 100000 },
      context: { project_context_enabled: false, project_instructions_enabled: false },
      execution: { mode: 'normal', approval_mode: 'full_access' },
      tools: { max_parallel_calls: 1 },
      memory: { enabled: false, background_review: { enabled: false } },
      ui: { language: 'en', reply_language: 'en' },
      soul: { preset: 'default' },
    };
    await saveConfig(config);
    const session = await createSession(dir);
    const runtime = await createChatRuntime({ config, model: 'test-model', systemPrompt: 'System', workspaceRoot: dir, session });

    // Three tool-call steps, then a final answer; each step reports a growing prompt size.
    const TOOL_STEPS = 3;
    let request = 0;
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      if (!body.stream) return Response.json({ choices: [{ message: { content: 'Title' } }] });
      request += 1;
      const delta = request <= TOOL_STEPS
        ? { tool_calls: [{ index: 0, id: `call-${request}`, type: 'function', function: { name: 'read', arguments: '{}' } }] }
        : { content: 'done' };
      const finish = request <= TOOL_STEPS ? 'tool_calls' : 'stop';
      const stream = sse({ choices: [{ index: 0, delta, finish_reason: null }] })
        + sse({ choices: [{ index: 0, delta: {}, finish_reason: finish }] })
        + sse({ choices: [], usage: { prompt_tokens: request * 10000, completion_tokens: 10, total_tokens: request * 10000 + 10 } })
        + 'data: [DONE]\n\n';
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
    };

    const events = [];
    const settled = Promise.withResolvers();
    bridge = new RuntimeBridge(runtime, {
      sessionId: session.id,
      onEvent: (event) => events.push(event),
      onLifecycle(event) {
        if (event.status !== 'running') settled.resolve(event.status);
      },
    });
    assert.equal(bridge.handleSubmitMessage({ text: 'inspect the repo' }).accepted, true);
    assert.equal(await settled.promise, 'completed');

    const responses = events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => event.type === 'assistant:response');
    assert.ok(responses.length >= TOOL_STEPS + 1);
    responses.forEach(({ event, index }, step) => {
      const nextResponse = responses[step + 1]?.index ?? events.length;
      const state = events.slice(index + 1, nextResponse).find((event) => event.type === 'runtime:state')?.state;
      assert.ok(state, `runtime:state should follow assistant:response #${step + 1}`);
      assert.equal(state.busy, true);
      // The meter must reflect the usage this response just reported, not the turn-start value.
      assert.equal(state.currentContextTokens, event.usage.inputTokens);
      assert.equal(state.contextUsagePct, (event.usage.inputTokens / 100000) * 100);
    });
  } finally {
    globalThis.fetch = originalFetch;
    await bridge?.dispose();
    closeSqliteDatabasesForTests();
    if (previousDir === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previousDir;
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
});
