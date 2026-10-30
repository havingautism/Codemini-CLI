import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { prepareRetryTurn } from '../src/core/retry-turn.js';
import { createChatRuntime } from '../src/core/chat-runtime.js';
import { RuntimeBridge } from '../codemini-web/lib/runtime-bridge.js';
import { createSession } from '../src/core/session-store.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import { loadUiTranscriptFromSqlite } from '../src/core/session-sqlite-store.js';
import { fetchWithRetry } from '../src/core/provider/fetch-with-retry.js';
import { waitForAcceptedOperation } from '../codemini-web/client/src/lib/chat-operation-waiter.js';
import { latestRetryableMessageId } from '../codemini-web/shared/transcript-segments.js';

test('only the newest error under the last question is retryable', () => {
  const user = (id) => ({ id, role: 'you' });
  const error = (id) => ({ id, role: 'error', responseStatus: 'error' });
  const messages = [user('q1'), error('e1'), error('e2')];
  assert.equal(latestRetryableMessageId(messages), 'e2');
  messages.push(user('q2'));
  assert.equal(latestRetryableMessageId(messages), '');
  messages.push(error('e3'), error('e4'));
  assert.equal(latestRetryableMessageId(messages), 'e4');
  messages.at(-1).retryable = false;
  assert.equal(latestRetryableMessageId(messages), '');
  assert.equal(latestRetryableMessageId([error('orphan')]), '');
});

test('completed answers can retry only when the entire latest turn has no file changes', () => {
  const user = { id: 'question', role: 'you' };
  const answer = { id: 'answer', role: 'general', isComplete: true, segments: [{ type: 'text', text: 'done' }] };
  assert.equal(latestRetryableMessageId([user, answer]), 'answer');
  assert.equal(latestRetryableMessageId([user, { ...answer, isComplete: false }]), '');
  assert.equal(latestRetryableMessageId([user, answer, { id: 'next', role: 'you' }]), '');
  for (const changeMessage of [
    { role: 'general', fileChanges: [{ path: 'app.js', reverted: true }] },
    { role: 'general', segments: [{ type: 'tools', cards: [{ fileChanges: [{ path: 'app.js' }] }] }] },
  ]) {
    assert.equal(latestRetryableMessageId([user, changeMessage, answer]), '');
    assert.equal(latestRetryableMessageId([user, changeMessage, { id: 'failure', role: 'error', responseStatus: 'error' }]), '');
  }
  assert.equal(latestRetryableMessageId([
    { id: 'old', role: 'you' }, { role: 'general', fileChanges: [{ path: 'old.js' }] }, user, answer,
  ]), 'answer');
  assert.throws(() => prepareRetryTurn([
    { role: 'user', content: 'question' }, { role: 'tool', tool_file_changes: [{ path: 'app.js' }] },
  ], 0), /file changes/);
});

test('retry refuses to discard later turns and ignores internal model context', () => {
  const messages = [{ role: 'user', content: 'first' }, { role: 'user', content: 'internal', model_context: true },
    { role: 'user', content: 'last', model_content: 'injected skill' }, { role: 'assistant', content: 'Failed' }];
  assert.throws(() => prepareRetryTurn(messages, 0), /latest/);
  assert.equal(prepareRetryTurn(messages, 1).user.model_content, 'injected skill');
  assert.equal(prepareRetryTurn(messages, 1).messages.length, 3);
});

test('transport errors expose their safe cause code and operation errors are already reported', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => { throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND', message: 'secret URL' } }); };
  await assert.rejects(fetchWithRetry('https://example.com', {}, { maxRetries: 0 }), (error) =>
    error.message === 'fetch failed (ENOTFOUND)' && !error.message.includes('secret'));
  await assert.rejects(waitForAcceptedOperation({ operationId: 'op' }, {
    sessionId: 'session', waiters: new Map(), earlyResults: new Map([['session:op', { type: 'error', text: 'failed' }]]),
  }), (error) => error.reportedByRuntime === true);
});

test('retry keeps the original skill and attachment context in one user turn across repeated failure and refresh', async (t) => {
  closeSqliteDatabasesForTests();
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-retry-'));
  process.env.CODEMINI_GLOBAL_DIR = dir;
  let bridge;
  let succeed = false;
  const bodies = [];
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    bodies.push(JSON.parse(body));
    if (!succeed) { res.writeHead(400); res.end('test failure'); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const skillDir = path.join(dir, 'skills', 'retry-test');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: retry-test\ndescription: test\n---\nUNIQUE_SKILL_INSTRUCTIONS');
    const session = await createSession(dir);
    session.title = 'Retry test';
    const runtime = await createChatRuntime({ session, workspaceRoot: dir, model: 'test', systemPrompt: 'Test.', config: {
      gateway: { base_url: `http://127.0.0.1:${server.address().port}/v1`, api_key: 'test', max_retries: 0 },
      sdk: { provider: 'openai-compatible' }, model: { name: 'test', reasoning_enabled: false },
      context: { project_context_enabled: false, project_instructions_enabled: false, microcompact_enabled: false },
      memory: { enabled: false, background_review: { enabled: false } },
      execution: { mode: 'normal', approval_mode: 'auto' }, tools: { max_parallel_calls: 1 },
      ui: { language: 'en', reply_language: 'en' }, soul: { preset: 'default' },
    } });
    let done;
    bridge = new RuntimeBridge(runtime, { sessionId: session.id, onEvent(event) {
      if (event.type === 'submit:done') done?.resolve(event);
    } });
    const run = async (start) => {
      done = Promise.withResolvers();
      start();
      const event = await done.promise;
      await new Promise((resolve) => setImmediate(resolve));
      return event;
    };
    const first = await run(() => bridge.handleSubmitMessage({ text: 'hello', skillNames: ['retry-test'],
      modelText: '<uploaded_attachments>UNIQUE_ATTACHMENT_CONTEXT</uploaded_attachments>' }));
    assert.equal(first.result.type, 'error');
    let errorId = first.result.errorMessageId;
    const second = await run(() => bridge.handleSubmitMessage({ retryMessageId: errorId }));
    assert.equal(second.result.type, 'error');
    assert.notEqual(second.result.errorMessageId, errorId);
    assert.equal(runtime.getSessionMessages().filter((message) => message.response_status === 'error').length, 1);
    errorId = second.result.errorMessageId;
    let ui = await bridge.getUiMessages();
    assert.equal(ui.filter((message) => message.role === 'you').length, 1);
    assert.equal(ui.filter((message) => message.role === 'error').length, 1);
    succeed = true;
    const third = await run(() => bridge.handleSubmitMessage({ retryMessageId: errorId }));
    assert.notEqual(third.result.type, 'error', third.result.text);
    const completed = (await bridge.getUiMessages()).findLast((message) => message.role === 'general');
    const regenerated = await run(() => bridge.handleSubmitMessage({ retryMessageId: completed.id }));
    assert.notEqual(regenerated.result.type, 'error', regenerated.result.text);
    const user = runtime.getSessionMessages().filter((message) => message.role === 'user' && !message.model_context);
    assert.equal(user.length, 1);
    assert.deepEqual(user[0].selected_skill_names, ['retry-test']);
    for (const body of bodies.slice(0, 3)) {
      const text = JSON.stringify(body.messages);
      assert.match(text, /UNIQUE_SKILL_INSTRUCTIONS/);
      assert.match(text, /UNIQUE_ATTACHMENT_CONTEXT/);
      assert.equal(body.messages.filter((message) => message.role === 'user').length, 1);
    }
    await bridge.dispose();
    ui = loadUiTranscriptFromSqlite(session.id);
    assert.equal(ui.filter((message) => message.role === 'you').length, 1);
    assert.equal(ui.filter((message) => message.role === 'error').length, 0);
  } finally {
    await bridge?.dispose();
    server.closeAllConnections?.(); server.close();
    closeSqliteDatabasesForTests();
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
});
