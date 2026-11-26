import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { createChatRuntime } from '../src/core/chat-runtime.js';
import { saveConfig } from '../src/core/config-store.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import { createSession, loadSession } from '../src/core/session-store.js';
import { RuntimeBridge } from '../codemini-web/lib/runtime-bridge.js';
import { loadUiTranscriptFromSqlite } from '../src/core/session-sqlite-store.js';
import { getSessionTokenUsage } from '../src/core/token-usage-store.js';
import { userSkillChipBadges } from '../codemini-web/client/src/lib/user-skill-prompt.js';

async function withGlobalDir(task) {
  closeSqliteDatabasesForTests();
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-abort-'));
  process.env.CODEMINI_GLOBAL_DIR = dir;
  try {
    return await task(dir);
  } finally {
    closeSqliteDatabasesForTests();
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
}

function sseChunk(content) {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { content }, finish_reason: null }]
  })}\n\n`;
}

// Request 1 streams forever (until the client aborts). Every later request
// streams a short reply and finishes, so the "continue after stop" turn can
// complete. Captures the JSON body of every request for payload assertions.
// Note: collect the request body with async iteration — registering a flowing
// 'data' listener makes undici fetch stall on this Node version.
function startGateway() {
  const bodies = [];
  let requestCount = 0;
  const server = http.createServer(async (req, res) => {
    let raw = '';
    try {
      for await (const chunk of req) raw += chunk;
    } catch {
      // client aborted while the body was still in flight; keep whatever arrived
    }
    try { bodies.push(JSON.parse(raw)); } catch { bodies.push(null); }
    const index = ++requestCount;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    if (index === 1) {
      // First (aborted) turn: never finishes on its own.
      const timer = setInterval(() => res.write(sseChunk('partial-')), 40);
      timer.unref?.();
      req.on('close', () => clearInterval(timer));
      return;
    }
    let sent = 0;
    const timer = setInterval(() => {
      sent += 1;
      if (sent >= 3) {
        clearInterval(timer);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      res.write(sseChunk(`done-${sent}-`));
    }, 40);
    timer.unref?.();
    req.on('close', () => clearInterval(timer));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, bodies, port: server.address().port }));
  });
}

function baseConfig(port) {
  return {
    sdk: { provider: 'openai-compatible' },
    gateway: { base_url: `http://127.0.0.1:${port}/v1`, api_key: 'test-key', timeout_ms: 5000, max_retries: 0 },
    model: { name: 'test-model', reasoning_enabled: false, reasoning_effort: 'off' },
    context: {
      project_context_enabled: false,
      project_instructions_enabled: false,
      microcompact_enabled: false
    },
    execution: { mode: 'normal', approval_mode: 'auto' },
    tools: { max_parallel_calls: 1 },
    memory: { enabled: false, background_review: { enabled: false } },
    ui: { language: 'en', reply_language: 'en' },
    soul: { preset: 'default' }
  };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('overflow recovery persists the compact view and forwards only UI metadata', async () => {
  await withGlobalDir(async (dir) => {
    const config = baseConfig(0);
    config.model.max_context_tokens = 32000;
    config.model.fast_name = 'compact-model';
    await saveConfig(config);
    const session = await createSession(dir);
    const oldContent = 'OLD_HISTORY ' + 'old work '.repeat(1000);
    session.messages.push(
      { role: 'user', content: oldContent },
      { role: 'assistant', content: 'old reply' },
    );
    const runtimeOptions = { config, model: 'test-model', systemPrompt: 'System test marker', workspaceRoot: dir };
    const runtime = await createChatRuntime({ ...runtimeOptions, session });
    const events = [];
    const bodies = [];
    const summaries = [];
    const settled = Promise.withResolvers();
    const bridge = new RuntimeBridge(runtime, {
      sessionId: session.id,
      onEvent: (event) => events.push(event),
      onLifecycle(event) {
        if (event.status !== 'running') settled.resolve(event.status);
      },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.model === 'compact-model') {
        summaries.push(body.messages[1].content);
        if (summaries.length === 1) {
          return Response.json({ error: { message: 'maximum context length exceeded' } }, { status: 400 });
        }
        return Response.json({ choices: [{ message: { content: 'Summary of the old work' } }] });
      }
      bodies.push(body);
      if (bodies.length === 1) {
        return Response.json({ error: { message: 'maximum context length exceeded' } }, { status: 400 });
      }
      return new Response(sseChunk('ok') + 'data: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      });
    };
    try {
      assert.equal(bridge.handleSubmitMessage({ text: 'keep this request' }).accepted, true);
      assert.equal(await settled.promise, 'completed');

      const loaded = await loadSession(session.id);
      assert.equal(loaded.messages[0].content, oldContent);
      assert.equal(loaded.compact.view[0].compaction.kind, 'summary');
      assert.match(loaded.compact.view[0].content, /Summary of the old work/);
      assert.equal(summaries.length, 2);
      assert.ok(summaries[1].length < summaries[0].length);
      const firstPreserved = loaded.compact.view.find((message) => Number.isInteger(message.compact_source_index));
      assert.equal(loaded.compact.boundaryIndex, firstPreserved.compact_source_index);
      assert.equal(loaded.messages[loaded.compact.boundaryIndex].content, firstPreserved.content);
      assert.ok(loaded.compact.view.some((message) => message.content === 'keep this request'));
      assert.ok(!loaded.compact.view.some((message) => message.role === 'system' && message.content.includes('System test marker')));

      const compactions = events.filter((event) => event.type === 'compact:auto');
      assert.equal(compactions.length, 1);
      assert.equal(Object.hasOwn(compactions[0], 'messages'), false);

      const reopened = await createChatRuntime({ ...runtimeOptions, session: loaded });
      try {
        await reopened.submitMessage({ text: 'next request' });
        await reopened.dispatchAction({ name: 'compact', payload: { args: ['--restore'] } });
        assert.equal((await loadSession(session.id)).compact, undefined);
      } finally {
        await reopened.dispose?.();
      }
      assert.equal(bodies.length, 3);
      assert.deepEqual(bodies.map((body) => body.messages.some((message) => message.content === oldContent)), [true, false, false]);
      assert.ok(bodies[2].messages.some((message) => String(message.content).includes('<conversation-checkpoint>')));
      assert.ok(bodies[2].messages.every((message) => !Object.hasOwn(message, 'compaction')));
    } finally {
      globalThis.fetch = originalFetch;
      await bridge.dispose();
    }
  });
});

test('model interruptions during parallel inline tasks keep the parent session and allow retry', async () => {
  await withGlobalDir(async (dir) => {
    const session = await createSession(dir);
    const config = baseConfig(0);
    config.execution.mode = 'plan';
    config.model.fast_name = 'lite-model';
    config.tools.max_parallel_calls = 2;
    const originalFetch = globalThis.fetch;
    const events = [];
    const calls = [
      { index: 0, id: 'call-sub', function: { name: 'run_subagent', arguments: JSON.stringify({ prompt: 'Inspect gateway', name: 'Inspector', tools: ['read'] }) } },
      { index: 1, id: 'call-fork', function: { name: 'fork_task', arguments: JSON.stringify({ prompt: 'Check sibling branch', name: 'Sibling' }) } },
    ];
    function stream(delta, finishReason) {
      return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: finishReason }] })}\n\ndata: [DONE]\n\n`, {
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    let dispatchCount = 0;
    const runtime = await createChatRuntime({ session, config, model: 'test-model', systemPrompt: 'Test.', workspaceRoot: dir });
    let settled = Promise.withResolvers();
    const bridge = new RuntimeBridge(runtime, {
      sessionId: session.id,
      onEvent: (event) => events.push(event),
      onLifecycle(event) {
        if (event.status !== 'running') settled.resolve(event);
      },
    });
    globalThis.fetch = async (_url, init) => {
      const { model, messages } = JSON.parse(init.body);
      const tail = messages.at(-1);
      if (model === 'lite-model' || tail.role === 'tool') {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      if (String(tail.content).includes('Branch task:\nCheck sibling branch')) {
        return stream({ content: 'Sibling finished.' }, 'stop');
      }
      if (++dispatchCount === 1) return stream({ tool_calls: calls }, 'tool_calls');
      return stream({ content: 'Retry finished.' }, 'stop');
    };
    try {
      assert.equal(bridge.handleSubmitMessage({ text: 'Check the workspace' }).accepted, true);
      assert.deepEqual(await settled.promise, { sessionId: session.id, status: 'failed' });
      assert.ok(events.some((event) => event.type === 'plan:step_done' && event.toolCallId === 'call-sub' && event.status === 'failed'));
      assert.ok(events.some((event) => event.type === 'plan:step_done' && event.toolCallId === 'call-fork' && event.status === 'done'));
      assert.equal(runtime.getCurrentSessionId(), session.id);
      assert.ok(events.every((event) => event.type !== 'session:forked'));
      await new Promise(setImmediate);
      const failure = (await bridge.getUiMessages()).find((message) => message.role === 'error');
      assert.match(failure.text, /Model request interrupted/);
      assert.equal(failure.retryable, true);
      settled = Promise.withResolvers();
      assert.equal(bridge.handleRetryMessage(failure.id).accepted, true);
      assert.deepEqual(await settled.promise, { sessionId: session.id, status: 'completed' });
      assert.ok(events.some((event) => event.type === 'submit:done' && event.result?.text === 'Retry finished.'));
      assert.equal(runtime.getCurrentSessionId(), session.id);
      assert.deepEqual((await runtime.getSessionHistory()).map((entry) => entry.id), [session.id]);
    } finally {
      globalThis.fetch = originalFetch;
      await bridge.dispose();
    }
  });
});

test('slash skill survives a real streamed abort in the user bubble, core history and context tab', async (t) => {
  await withGlobalDir(async (dir) => {
    const { server, port } = await startGateway();
    t.after(() => { server.closeAllConnections?.(); server.close(); });
    const skillDir = path.join(dir, 'skills', 'abort-skill');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: abort-skill\ndescription: test\n---\nABORT_SKILL_CONTEXT');
    const session = await createSession(dir);
    const runtime = await createChatRuntime({ session, config: baseConfig(port), model: 'test-model', systemPrompt: 'Test.', workspaceRoot: dir });
    const streamed = Promise.withResolvers();
    const forked = Promise.withResolvers();
    const bridge = new RuntimeBridge(runtime, { sessionId: session.id, onEvent(event) {
      if (event.type === 'assistant:delta') streamed.resolve();
      if (event.type === 'session:forked') forked.resolve(event.nextSessionId);
    } });
    try {
      bridge.handleSubmitMessage({ text: '/abort-skill debug' });
      await streamed.promise;
      await bridge.handleAbort();
      const continuationId = await forked.promise;
      const stored = await loadSession(session.id);
      assert.deepEqual(stored.messages[0].selected_skill_names, ['abort-skill']);
      for (const id of [session.id, continuationId]) {
        const messages = loadUiTranscriptFromSqlite(id);
        assert.deepEqual(userSkillChipBadges(messages[0].skillBadges), [{ name: 'abort-skill', status: 'selected' }]);
        assert.equal(messages.flatMap((message) => message.segments || []).filter((segment) => segment.type === 'skill').length, 1);
        const usage = getSessionTokenUsage(id);
        assert.ok(usage.totals.requests >= 1);
        assert.equal(usage.totals.reportedRequests, 0);
        assert.ok(usage.totals.timedRequests >= 1);
      }
    } finally { await bridge.dispose(); }
  });
});

test('manual stop discards partial turn messages and keeps the next turn clean', async (t) => {
  await withGlobalDir(async (dir) => {
    const { server, bodies, port } = await startGateway();
    t.after(() => {
      server.closeAllConnections?.();
      server.close();
    });

    const session = await createSession(dir);
    const runtime = await createChatRuntime({
      session,
      config: baseConfig(port),
      model: 'test-model',
      systemPrompt: 'You are a test.',
      workspaceRoot: dir
    });

    // Turn 1 starts streaming, then the user manually stops it.
    const turnA = runtime.submitMessage({ text: 'first question' });
    await delay(150);
    assert.equal(runtime.abort(), true);
    await assert.rejects(turnA, (error) => error?.name === 'AbortError');

    // The aborted turn stays on the original session (hidden from the model).
    // Continuation happens on a new session so the next reply is not appended
    // under the stopped turn.
    await delay(50);
    assert.equal(session.messages.length, 1);
    assert.equal(session.messages[0].role, 'user');
    assert.equal(session.messages[0].content, 'first question');
    assert.equal(session.messages[0].local_only, true);
    assert.equal(session.messages[0].model_visible, false);

    const stored = await loadSession(session.id);
    assert.equal(stored.messages.length, 1);
    assert.equal(stored.messages[0].local_only, true);

    const continuationId = runtime.getCurrentSessionId();
    assert.notEqual(continuationId, session.id);
    const continuation = runtime.getSession();
    assert.equal(continuation.id, continuationId);
    assert.equal(continuation.messages.length, 0);

    const turnB = await runtime.submitMessage({ text: 'second question' });
    assert.equal(turnB.type, 'assistant');
    assert.match(String(turnB.text || ''), /done-/);
    assert.equal(runtime.getCurrentSessionId(), continuationId);
    const secondUser = continuation.messages.find(
      (message) => message?.role === 'user' && message.content === 'second question',
    );
    assert.ok(secondUser);
    assert.match(secondUser.model_content, /<runtime>/);
    assert.match(secondUser.model_content, /<task>\s*second question\s*<\/task>/);
    assert.equal(secondUser.model_content_scope, undefined);
    assert.ok(session.messages.every((message) => message.content !== 'second question'));

    const secondBody = bodies.find((body) => Array.isArray(body?.messages)
      && body.messages.some((message) => message?.role === 'user'
        && String(message.content || '').includes('second question')));
    assert.ok(secondBody, 'gateway received a second request with the new question');
    const sentText = secondBody.messages
      .filter((message) => message?.role === 'user')
      .map((message) => String(message.content || ''))
      .join('|');
    assert.ok(!sentText.includes('first question'), 'aborted prompt must not reach the gateway again');
    assert.ok(sentText.includes('second question'), 'new question reaches the gateway');

    await runtime.dispose?.();
  });
});

test('manual stop during a tool loop removes dangling assistant/tool pairs', async (t) => {
  await withGlobalDir(async (dir) => {
    // First completion requests a tool call; the tool dispatcher is not
    // registered, so the loop keeps retrying until the abort lands.
    const server = http.createServer(async (req, res) => {
      try {
        for await (const chunk of req) { void chunk; }
      } catch {
        // client aborted mid-body
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const timer = setInterval(() => {
        res.write(`data: ${JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion.chunk',
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_abort_test',
                type: 'function',
                function: { name: 'list', arguments: '{"path":"."}' }
              }]
            },
            finish_reason: 'tool_calls'
          }]
        })}\n\n`);
        res.write('data: [DONE]\n\n');
        clearInterval(timer);
        res.end();
      }, 100);
      timer.unref?.();
      req.on('close', () => clearInterval(timer));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => {
      server.closeAllConnections?.();
      server.close();
    });

    const session = await createSession(dir);
    const runtime = await createChatRuntime({
      session,
      config: baseConfig(server.address().port),
      model: 'test-model',
      systemPrompt: 'You are a test.',
      workspaceRoot: dir
    });

    const turnA = runtime.submitMessage({ text: 'list the repo' });
    await delay(300);
    runtime.abort();
    await assert.rejects(turnA, (error) => error?.name === 'AbortError');
    await delay(100);

    assert.equal(session.messages.length, 1);
    assert.equal(session.messages[0].role, 'user');
    assert.equal(session.messages[0].local_only, true);
    assert.ok(
      session.messages.every((message) => !Array.isArray(message.tool_calls)),
      'no assistant message with dangling tool_calls survives the abort'
    );
    assert.ok(
      session.messages.every((message) => message.role !== 'tool'),
      'no orphaned tool result survives the abort'
    );
    assert.notEqual(runtime.getCurrentSessionId(), session.id);
    assert.equal(runtime.getSession().messages.length, 0);

    await runtime.dispose?.();
  });
});

test('manual stop after a completed turn copies prior history into the new session', async (t) => {
  await withGlobalDir(async (dir) => {
    const bodies = [];
    let requestCount = 0;
    const server = http.createServer(async (req, res) => {
      let raw = '';
      try {
        for await (const chunk of req) raw += chunk;
      } catch {
        // client aborted while the body was still in flight
      }
      try { bodies.push(JSON.parse(raw)); } catch { bodies.push(null); }
      const index = ++requestCount;
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      if (index === 2) {
        const timer = setInterval(() => res.write(sseChunk('partial-')), 40);
        timer.unref?.();
        req.on('close', () => clearInterval(timer));
        return;
      }
      let sent = 0;
      const timer = setInterval(() => {
        sent += 1;
        if (sent >= 3) {
          clearInterval(timer);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        res.write(sseChunk(`done-${sent}-`));
      }, 40);
      timer.unref?.();
      req.on('close', () => clearInterval(timer));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => {
      server.closeAllConnections?.();
      server.close();
    });

    const session = await createSession(dir);
    const runtime = await createChatRuntime({
      session,
      config: baseConfig(server.address().port),
      model: 'test-model',
      systemPrompt: 'You are a test.',
      workspaceRoot: dir
    });

    const first = await runtime.submitMessage({ text: 'keep this exchange' });
    assert.equal(first.type, 'assistant');
    const priorCount = session.messages.length;
    assert.ok(priorCount >= 2);

    const aborted = runtime.submitMessage({ text: 'stop this one' });
    await delay(150);
    assert.equal(runtime.abort(), true);
    await assert.rejects(aborted, (error) => error?.name === 'AbortError');
    await delay(50);

    const continuation = runtime.getSession();
    assert.notEqual(continuation.id, session.id);
    assert.equal(continuation.messages.length, priorCount);
    assert.ok(continuation.messages.some((message) => message?.content === 'keep this exchange'));
    assert.ok(continuation.messages.every((message) => message?.content !== 'stop this one'));
    assert.ok(session.messages.some((message) => message?.content === 'stop this one' && message.local_only === true));

    await runtime.dispose?.();
  });
});

test('continue-in-place abort keeps the stopped turn and appends the next prompt below it', async (t) => {
  await withGlobalDir(async (dir) => {
    const { server, bodies, port } = await startGateway();
    t.after(() => {
      server.closeAllConnections?.();
      server.close();
    });

    const session = await createSession(dir);
    const runtime = await createChatRuntime({
      session,
      config: baseConfig(port),
      model: 'test-model',
      systemPrompt: 'You are a test.',
      workspaceRoot: dir
    });

    const turnA = runtime.submitMessage({ text: 'first question' });
    await delay(150);
    assert.equal(runtime.abort({ continueInPlace: true }), true);
    await assert.rejects(turnA, (error) => error?.name === 'AbortError');
    await delay(50);

    assert.equal(runtime.getCurrentSessionId(), session.id);
    assert.equal(session.messages[0]?.role, 'user');
    assert.equal(session.messages[0]?.content, 'first question');
    assert.notEqual(session.messages[0]?.local_only, true);

    const turnB = await runtime.submitMessage({ text: 'jumped question' });
    assert.equal(turnB.type, 'assistant');
    assert.equal(runtime.getCurrentSessionId(), session.id);
    assert.ok(session.messages.some((message) => message?.role === 'user' && message.content === 'first question'));
    assert.ok(session.messages.some((message) => message?.role === 'user' && message.content === 'jumped question'));

    const jumpedBody = bodies.find((body) => Array.isArray(body?.messages)
      && body.messages.some((message) => message?.role === 'user'
        && String(message.content || '').includes('jumped question')));
    assert.ok(jumpedBody, 'gateway received the jumped prompt on the same session');

    await runtime.dispose?.();
  });
});
