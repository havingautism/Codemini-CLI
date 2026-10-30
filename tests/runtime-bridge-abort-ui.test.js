import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { RuntimeBridge, serializeSessionMessages } from '../codemini-web/lib/runtime-bridge.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import { loadUiTranscriptFromSqlite } from '../src/core/session-sqlite-store.js';

test('runtime-only model context is replayed to the model but hidden from fallback UI history', () => {
  assert.deepEqual(serializeSessionMessages([
    { role: 'user', content: 'visible' },
    { role: 'user', content: 'internal', model_context: true },
    { role: 'assistant', content: 'done' },
  ]).map((message) => message.content), ['visible', 'done']);
});

test('network failure removes its empty placeholder from live and persisted UI history', async () => {
  closeSqliteDatabasesForTests();
  const previousGlobalDir = process.env.CODEMINI_GLOBAL_DIR;
  const globalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-network-error-ui-'));
  process.env.CODEMINI_GLOBAL_DIR = globalDir;
  const sessionId = 'network-error-session';
  const done = Promise.withResolvers();
  const runtime = {
    getCurrentSessionId: () => sessionId,
    getRuntimeState: () => ({ sessionId }),
    getLastSystemPrompt: () => '',
    setRequestToolApproval() {},
    setRequestUserInput() {},
    setOnTitleUpdate() {},
    setOnTitleStatus() {},
    async submit(_line, onEvent) {
      onEvent({ type: 'assistant:start', messageId: 'empty-reply' });
      onEvent({ type: 'step:start', step: 1 });
      throw new Error('fetch failed');
    },
  };
  const bridge = new RuntimeBridge(runtime, {
    sessionId,
    onEvent(event) { if (event.type === 'submit:done') done.resolve(); },
  });
  try {
    bridge.handleSubmit('question');
    await done.promise;
    const live = await bridge.getUiMessages();
    assert.deepEqual(live.map((message) => message.role), ['you', 'error']);
    assert.equal(live[1].text, 'Failed: fetch failed');
    await bridge.dispose();
    assert.deepEqual(loadUiTranscriptFromSqlite(sessionId).map((message) => message.role), ['you', 'error']);
  } finally {
    await bridge.dispose();
    closeSqliteDatabasesForTests();
    if (previousGlobalDir === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previousGlobalDir;
    await fs.rm(globalDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
});

test('abort continuation keeps the settled partial reply in its UI transcript', async () => {
  closeSqliteDatabasesForTests();
  const previousGlobalDir = process.env.CODEMINI_GLOBAL_DIR;
  const globalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-abort-ui-'));
  process.env.CODEMINI_GLOBAL_DIR = globalDir;
  let sessionId = 'session-before-abort';

  const runtime = {
    getCurrentSessionId: () => sessionId,
    getRuntimeState: () => ({ sessionId }),
    getLastSystemPrompt: () => '',
    setRequestToolApproval() {},
    setRequestUserInput() {},
    setOnTitleUpdate() {},
    setOnTitleStatus() {},
    submit(_line, onEvent) {
      onEvent({ type: 'assistant:start', messageId: 'reply-1' });
      onEvent({ type: 'assistant:delta', messageId: 'reply-1', text: 'already visible' });
      sessionId = 'session-after-abort';
      onEvent({
        type: 'session:forked',
        previousSessionId: 'session-before-abort',
        sessionId,
      });
      return new Promise(() => {});
    },
  };

  const bridge = new RuntimeBridge(runtime, { sessionId });
  try {
    assert.deepEqual(bridge.handleSubmit('question'), { accepted: true });

    const copied = loadUiTranscriptFromSqlite('session-after-abort');
    assert.equal(copied.length, 2);
    assert.equal(copied[0].role, 'you');
    assert.equal(copied[1].manualAborted, true);
    assert.equal(copied[1].segments[0].text, 'already visible');
    assert.equal(copied[1].segments[0].isStreaming, false);
  } finally {
    await bridge.dispose();
    closeSqliteDatabasesForTests();
    if (previousGlobalDir === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previousGlobalDir;
    await fs.rm(globalDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
});
