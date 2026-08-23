import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  closeSqliteDatabasesForTests
} from '../src/core/sqlite-database.js';
import { createSession, loadSession, saveSession } from '../src/core/session-store.js';
import { loadUiTranscriptFromSqlite } from '../src/core/session-sqlite-store.js';
import {
  forkIdleSession,
  sessionForkBlockedReason,
  sliceCoreMessagesThroughUi,
  sliceUiMessagesThrough
} from '../src/core/session-fork.js';

async function withGlobalDir(task) {
  closeSqliteDatabasesForTests();
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-fork-'));
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

test('busy sessions cannot be forked', () => {
  assert.equal(sessionForkBlockedReason({ busy: true }), 'Session is still running');
  assert.equal(sessionForkBlockedReason({ status: 'running' }), 'Session is still running');
  assert.equal(sessionForkBlockedReason({ status: 'waiting_approval' }), 'Session is still running');
  assert.equal(sessionForkBlockedReason({ status: 'idle' }), '');
  assert.equal(sessionForkBlockedReason({}), '');
});

test('slice keeps the prefix through the clicked message', () => {
  const ui = [
    { id: 'u1', role: 'you' },
    { id: 'a1', role: 'assistant' },
    { id: 'u2', role: 'you' },
    { id: 'a2', role: 'assistant' }
  ];
  assert.deepEqual(sliceUiMessagesThrough(ui, 'a1').map((m) => m.id), ['u1', 'a1']);
  assert.equal(sliceUiMessagesThrough(ui, 'missing'), null);

  const core = [
    { role: 'user', content: 'one' },
    { role: 'assistant', content: 'two' },
    { role: 'tool', content: 'tool' },
    { role: 'assistant', content: 'two-b' },
    { role: 'user', content: 'three' },
    { role: 'assistant', content: 'four' }
  ];
  assert.deepEqual(
    sliceCoreMessagesThroughUi(core, sliceUiMessagesThrough(ui, 'a1')).map((m) => m.content),
    ['one', 'two', 'tool', 'two-b']
  );
  assert.deepEqual(
    sliceCoreMessagesThroughUi(core, sliceUiMessagesThrough(ui, 'u2')).map((m) => m.content),
    ['one', 'two', 'tool', 'two-b', 'three']
  );
});

test('forkIdleSession copies only the prefix at the clicked answer', async () => {
  await withGlobalDir(async (dir) => {
    const source = await createSession(dir);
    source.title = 'Original';
    source.messages = [
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
      { role: 'user', content: 'three' },
      { role: 'assistant', content: 'four' }
    ];
    source.todos = [{ content: 'do it', status: 'pending' }];
    await saveSession(source);
    const ui = [
      { id: 'u1', role: 'you', text: 'one' },
      { id: 'a1', role: 'assistant', text: 'two' },
      { id: 'u2', role: 'you', text: 'three' },
      { id: 'a2', role: 'assistant', text: 'four' }
    ];

    const created = await forkIdleSession(source, { uiMessages: ui, messageId: 'a1' });
    assert.notEqual(created.id, source.id);
    assert.equal(created.title, 'Original-fork');
    assert.deepEqual(created.messages.map((m) => m.content), ['one', 'two']);
    assert.deepEqual(loadUiTranscriptFromSqlite(created.id).map((m) => m.id), ['u1', 'a1']);

    created.messages[0].content = 'mutated';
    created.todos[0].status = 'completed';
    const reloaded = await loadSession(source.id);
    assert.equal(reloaded.messages.length, 4);
    assert.equal(reloaded.messages[0].content, 'one');
    assert.equal(reloaded.todos[0].status, 'pending');

    const again = await forkIdleSession(created, { uiMessages: loadUiTranscriptFromSqlite(created.id), messageId: 'a1' });
    assert.notEqual(again.id, created.id);
    assert.equal(again.title, 'Original-fork');
  });
});

test('web UI forks the clicked message, not the whole transcript', async () => {
  const bubble = await fs.readFile(
    new URL('../codemini-web/client/src/components/MessageBubble.jsx', import.meta.url),
    'utf8'
  );
  assert.match(bubble, /canSaveToScrapbook=\{false\}\s+onRetry=\{onRetry\}/);
  assert.match(bubble, /showFork\s+canFork=\{!turnActive\}/);
  assert.match(bubble, /forkSession\(messageId\)/);
  const server = await fs.readFile(
    new URL('../codemini-web/server.js', import.meta.url),
    'utf8'
  );
  assert.match(server, /\/api\/sessions\/fork/);
  assert.match(server, /body\?\.messageId/);
});
