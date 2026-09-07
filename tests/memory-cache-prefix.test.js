import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { createChatRuntime } from '../src/core/chat-runtime.js';
import { initializeProjectIndex } from '../src/core/project-index.js';
import { rememberMemory } from '../src/core/memory-store.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import { createSession, loadSession } from '../src/core/session-store.js';

async function withRuntime(task, mode = 'normal', indexed = false) {
  closeSqliteDatabasesForTests();
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-memory-cache-'));
  process.env.CODEMINI_GLOBAL_DIR = dir;
  const bodies = [];
  let respond = () => 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    bodies.push(JSON.parse(raw));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(await respond({ body: bodies.at(-1), bodies }));
  });
  const blockedFetchPorts = new Set([2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080]);
  do {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    if (!blockedFetchPorts.has(server.address().port)) break;
    await new Promise((resolve) => server.close(resolve));
  } while (true);
  try {
    const port = server.address().port;
    const config = {
      sdk: { provider: 'openai-compatible' },
      gateway: { base_url: `http://127.0.0.1:${port}/v1`, api_key: 'test', max_retries: 0 },
      model: { name: 'test-model', reasoning_enabled: false, reasoning_effort: 'off' },
      context: { project_context_enabled: false, project_instructions_enabled: false, preflight_trigger_pct: 99 },
      execution: { mode, approval_mode: 'auto' },
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
    if (indexed) {
      await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module' }));
      await fs.writeFile(path.join(dir, 'index.js'), 'export const example = 1;');
      await initializeProjectIndex(dir);
    }
    const session = await createSession(dir);
    const runtime = await createChatRuntime({ session, config, model: 'test-model', systemPrompt: 'stable', workspaceRoot: dir });
    await task({
      dir,
      bodies,
      runtime,
      config,
      session,
      setResponder: (next) => { respond = next; },
    });
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

test('image content blocks remain byte-identical in later requests and session reloads', async () => {
  await withRuntime(async ({ bodies, runtime, session }) => {
    const modelImages = [{ mime: 'image/png', data: 'aW1hZ2U=' }];
    await runtime.submitMessage({ text: 'inspect this image', modelImages });
    const stored = await loadSession(session.id);
    assert.deepEqual(stored.messages.find((message) => message.role === 'user')?.model_images, modelImages);

    await runtime.submitMessage({ text: 'continue' });
    const current = bodies[0].messages.find((message) => message.role === 'user');
    const historical = bodies[1].messages.find((message) => message.role === 'user');
    assert.deepEqual(historical.content, current.content);
    assert.equal(historical.content[1].image_url.url, 'data:image/png;base64,aW1hZ2U=');
  });
});

test('deferred tool activation remains visible on the next turn and after session reload', async () => {
  await withRuntime(async ({ bodies, runtime, session, config, setResponder }) => {
    config.context.prompt_request_audit = true;
    setResponder(({ bodies: requests }) => requests.length === 1
      ? [
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"search-1","function":{"name":"tool_search","arguments":"{\\"query\\":\\"web_fetch\\"}"}}]},"finish_reason":"tool_calls"}]}',
          '',
          'data: [DONE]',
          '',
        ].join('\n')
      : 'data: {"choices":[{"delta":{"content":"Loaded web_fetch and verified that the deferred schema is available for this session."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');

    await runtime.submitMessage({ text: 'load web_fetch' });
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].tools.some((tool) => tool.function.name === 'web_fetch'), false);
    assert.equal(bodies[1].tools.some((tool) => tool.function.name === 'web_fetch'), true);

    await runtime.submitMessage({ text: 'use it again' });
    assert.equal(bodies.length, 3);
    assert.equal(bodies[2].tools.some((tool) => tool.function.name === 'web_fetch'), true);
    assert.deepEqual(runtime.getSessionMessages().length > 0, true);
    const stored = await loadSession(session.id);
    assert.deepEqual(stored.activatedToolNames, ['web_fetch']);
    assert.equal(stored.promptRequestSnapshot.promptRevision, 2);
    assert.equal(stored.promptRequestSnapshot.toolCount, bodies[2].tools.length);
  });
});


test('coding turns send the main request directly without a route judge', async () => {
  await withRuntime(async ({ bodies, runtime }) => {
    for (const text of ['继续', '改一个按钮文案', '解释刚才的结果']) {
      const before = bodies.length;
      const events = [];
      await runtime.submitMessage({ text }, (event) => events.push(event));
      assert.equal(bodies.length - before, 1, text);
      assert.equal(events.some((event) => event.type === 'routing:graph'), false);
      assert.doesNotMatch(JSON.stringify(bodies.at(-1).messages), /semantic judge|<coding_harness/);
    }
  }, 'plan');
});


test('request auditing is opt-in and normal usage remains available', async () => {
  await withRuntime(async ({ runtime, session, config }) => {
    const events = [];
    await runtime.submitMessage({ text: 'hello' }, (event) => events.push(event));
    assert.equal(events.some((event) => event.type === 'prompt:request_audit'), false);
    assert.equal((await loadSession(session.id)).promptRequestSnapshot == null, true);
    config.context.prompt_request_audit = true;
    await runtime.submitMessage({ text: 'continue' }, (event) => events.push(event));
    assert.equal(events.some((event) => event.type === 'prompt:request_audit'), true);
    assert.ok((await loadSession(session.id)).promptRequestSnapshot);
  });
});

test('project navigation is injected once and preserved in history', async () => {
  await withRuntime(async ({ runtime, config, dir, bodies }) => {
    config.context.project_context_enabled = true;
    await runtime.submitMessage({ text: 'inspect index.js' });
    const first = bodies[0].messages.find((message) => message.role === 'user');
    assert.match(first.content, /<project_context>/);
    await runtime.submitMessage({ text: 'continue' });
    const users = bodies[1].messages.filter((message) => message.role === 'user');
    assert.equal(users[0].content, first.content);
    assert.doesNotMatch(users.at(-1).content, /<project_context>/);
  }, 'normal', true);
});
