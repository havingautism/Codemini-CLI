import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { createChatRuntime } from '../src/core/chat-runtime.js';
import { rememberMemory } from '../src/core/memory-store.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import { createSession } from '../src/core/session-store.js';

async function withRuntime(task) {
  closeSqliteDatabasesForTests();
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-memory-cache-'));
  process.env.CODEMINI_GLOBAL_DIR = dir;
  const bodies = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    bodies.push(JSON.parse(raw));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const config = {
      sdk: { provider: 'openai-compatible' },
      gateway: { base_url: `http://127.0.0.1:${port}/v1`, api_key: 'test', max_retries: 0 },
      model: { name: 'test-model', reasoning_enabled: false, reasoning_effort: 'off' },
      context: { project_context_enabled: false, project_instructions_enabled: false, preflight_trigger_pct: 99 },
      execution: { mode: 'normal', approval_mode: 'auto' },
      memory: {
        enabled: true,
        bootstrap: { enabled: true },
        retrieval: { enabled: false },
        experience: { enabled: false },
        writeback: { enabled: false },
        background_review: { enabled: false },
      },
      ui: { language: 'en', reply_language: 'en' },
      soul: { preset: 'default' },
    };
    const session = await createSession(dir);
    const runtime = await createChatRuntime({ session, config, model: 'test-model', systemPrompt: 'stable', workspaceRoot: dir });
    await task({ dir, bodies, runtime, config });
    await runtime.dispose?.();
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    closeSqliteDatabasesForTests();
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
}

test('bootstrap memory stays byte-identical for the lifetime of a session', async () => {
  await withRuntime(async ({ dir, bodies, runtime, config }) => {
    await rememberMemory({
      scope: 'project', family: 'repo', kind: 'convention',
      content: 'Run npm test before handoff.', workspaceRoot: dir, config,
    });
    await runtime.submitMessage({ text: 'first turn' });
    await rememberMemory({
      scope: 'project', family: 'repo', kind: 'convention',
      content: 'Do not edit generated files.', workspaceRoot: dir, config,
    });
    await runtime.submitMessage({ text: 'second turn' });
    assert.equal(bodies.length, 2);
    assert.equal(bodies[1].messages[0].content, bodies[0].messages[0].content);
  });
});

test('file-expanded user content remains byte-identical in later requests', async () => {
  await withRuntime(async ({ bodies, runtime }) => {
    await runtime.submitMessage({ text: 'inspect @file', modelText: 'expanded file contents' });
    await runtime.submitMessage({ text: 'continue' });
    const firstTurn = bodies[0].messages.find((message) => message.role === 'user');
    const historical = bodies[1].messages.find((message) => message.role === 'user');
    assert.deepEqual(historical.content, firstTurn.content);
  });
});
