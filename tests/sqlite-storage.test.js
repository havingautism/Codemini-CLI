import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  closeSqliteDatabasesForTests,
  getGlobalDatabase,
  getProjectDatabase
} from '../src/core/sqlite-database.js';
import {
  createSession,
  deleteSession,
  listSessions,
  loadSession,
  saveSession
} from '../src/core/session-store.js';
import {
  loadUiTranscriptFromSqlite,
  saveUiTranscriptToSqlite,
  sessionMessageWriteStart
} from '../src/core/session-sqlite-store.js';
import {
  claimSessionMemoryReview,
  completeSessionMemoryReview,
  failSessionMemoryReview
} from '../src/core/memory-review-store.js';
import {
  archiveEntry,
  captureToInbox,
  listArchive,
  listInbox,
  updateInboxEntry
} from '../src/core/memory-store.js';
import {
  initializeProjectIndex,
  queryProjectIndex,
  refreshIndexedFile
} from '../src/core/project-index.js';
import {
  loadProjectIndexFromSqlite,
  saveProjectIndexToSqlite
} from '../src/core/project-index-sqlite-store.js';
import {
  listChangeOperationsFromSqlite,
  loadChangeOperationFromSqlite,
  saveChangeOperationToSqlite
} from '../src/core/change-oplog-sqlite-store.js';
import {
  loadAttachmentMetadata,
  readRuntimeStatuses,
  recoverRuntimeStatuses,
  removeRuntimeStatus,
  saveAttachmentMetadata,
  setRuntimeStatus
} from '../src/core/web-metadata-sqlite-store.js';

async function withGlobalDir(task) {
  closeSqliteDatabasesForTests();
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-sqlite-'));
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

test('session SQLite store round-trips incremental messages and UI transcript', async () => {
  await withGlobalDir(async (dir) => {
    const session = await createSession(dir);
    session.messages.push({ role: 'user', content: 'hello' });
    await saveSession(session);
    session.messages.push({ role: 'assistant', content: 'world', usage: { totalTokens: 4 } });
    await saveSession(session);

    const loaded = await loadSession(session.id);
    assert.deepEqual(loaded.messages.map((message) => message.content), ['hello', 'world']);
    assert.equal((await listSessions(10))[0].messageCount, 2);

    saveUiTranscriptToSqlite(session.id, [{ id: 'ui-1', role: 'general', text: 'world' }]);
    assert.equal(loadUiTranscriptFromSqlite(session.id)[0].id, 'ui-1');
    assert.equal((await fs.stat(path.join(dir, 'codemini.sqlite'))).isFile(), true);

    assert.equal((await deleteSession(session.id)).removed >= 1, true);
    await assert.rejects(() => loadSession(session.id));
  });
});

test('session SQLite store round-trips lastSystemPrompt for trajectory reuse', async () => {
  await withGlobalDir(async (dir) => {
    const session = await createSession(dir);
    session.messages.push({ role: 'user', content: 'hello' });
    session.lastSystemPrompt = 'You are Codemini.\nFollow AGENTS.md.';
    await saveSession(session);

    const loaded = await loadSession(session.id);
    assert.equal(loaded.lastSystemPrompt, 'You are Codemini.\nFollow AGENTS.md.');
  });
});

test('session save rewrites in-place assistant and parallel-tool tail without dropping prefix', async () => {
  await withGlobalDir(async (dir) => {
    const session = await createSession(dir);
    const user = { role: 'user', content: 'hello' };
    const assistant = {
      role: 'assistant',
      content: 'one',
      tool_calls: [{ id: 't1', function: { name: 'read_file', arguments: '{}' } }]
    };
    session.messages.push(user, assistant);
    await saveSession(session);
    assistant.content = 'two';
    await saveSession(session);

    let loaded = await loadSession(session.id);
    assert.deepEqual(loaded.messages.map((message) => message.content), ['hello', 'two']);

    const tool = { role: 'tool', content: 'result', tool_call_id: 't1' };
    session.messages.push(tool);
    await saveSession(session);
    assistant.tool_calls[0].status = 'done';
    assistant.content = 'three';
    await saveSession(session);

    loaded = await loadSession(session.id);
    assert.equal(loaded.messages[0].content, 'hello');
    assert.equal(loaded.messages[1].content, 'three');
    assert.equal(loaded.messages[1].tool_calls[0].status, 'done');
    assert.equal(loaded.messages[2].content, 'result');
    assert.equal(sessionMessageWriteStart(session.id, session.messages), 1);
  });
});

test('legacy session JSONL imports once and is preserved in legacy-backup', async () => {
  await withGlobalDir(async (dir) => {
    const sessionsDir = path.join(dir, 'sessions');
    await fs.mkdir(sessionsDir, { recursive: true });
    const legacy = {
      id: 'legacy-session',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      title: 'Legacy',
      messages: [{ role: 'user', content: 'old data' }]
    };
    await fs.writeFile(path.join(sessionsDir, 'legacy-session.jsonl'), `${JSON.stringify(legacy)}\n`);
    assert.equal((await listSessions(10))[0].id, 'legacy-session');
    assert.equal((await fs.stat(path.join(sessionsDir, 'legacy-backup', 'legacy-session.jsonl'))).isFile(), true);
  });
});

test('memory review leases and queue transitions are transactional', async () => {
  await withGlobalDir(async () => {
    const first = await claimSessionMemoryReview({
      sessionId: 's1', contentHash: 'h1', reviewerVersion: 1, leaseMs: 60000
    });
    assert.equal(first.claimed, true);
    assert.equal((await claimSessionMemoryReview({
      sessionId: 's1', contentHash: 'h1', reviewerVersion: 1, leaseMs: 60000
    })).reason, 'active-lease');
    await completeSessionMemoryReview({
      sessionId: 's1', contentHash: 'h1', reviewerVersion: 1,
      reviewedMessageCount: 2, candidateCount: 1
    });
    assert.equal((await claimSessionMemoryReview({
      sessionId: 's1', contentHash: 'h1', reviewerVersion: 1
    })).reason, 'already-reviewed');
    assert.equal((await failSessionMemoryReview({
      sessionId: 's2', contentHash: 'h2', reviewerVersion: 1, error: new Error('nope')
    })).status, 'failed');

    const entry = await captureToInbox({
      summary: 'Prefer SQLite transactions', scope: 'global', idempotencyKey: 'sqlite-rule'
    });
    const duplicate = await captureToInbox({
      summary: 'Prefer SQLite transactions', scope: 'global', idempotencyKey: 'sqlite-rule'
    });
    assert.equal(duplicate.duplicate, true);
    assert.equal((await updateInboxEntry(entry.id, { lifecycle: 'operational' })).lifecycle, 'operational');
    await archiveEntry(entry, 'tested');
    assert.equal((await listInbox({})).length, 0);
    assert.equal((await listArchive({ scope: 'global' }))[0].archiveReason, 'tested');
  });
});

test('project index persists files and symbols in per-project SQLite', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-project-sqlite-'));
  try {
    await fs.writeFile(path.join(root, 'package.json'), '{"name":"fixture"}\n');
    await fs.mkdir(path.join(root, 'src'));
    await fs.writeFile(path.join(root, 'src', 'hello.js'), 'export function hello() { return 1; }\n');
    const initialized = await initializeProjectIndex(root);
    assert.equal(initialized.fileIndex.files.some((entry) => entry.file === 'src/hello.js'), true);
    assert.equal((await fs.stat(path.join(root, '.codemini', 'index.sqlite'))).isFile(), true);
    await assert.rejects(() => fs.stat(path.join(root, '.codemini', 'file-index.json')));

    await fs.writeFile(path.join(root, 'src', 'hello.js'), 'export function renamedHello() { return 2; }\n');
    await refreshIndexedFile(root, 'src/hello.js');
    const result = await queryProjectIndex(root, { query: 'renamedHello' });
    assert.equal(result.matches[0].file, 'src/hello.js');
  } finally {
    closeSqliteDatabasesForTests();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('project index sqlite load caches until updatedAt changes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-project-index-cache-'));
  try {
    const firstFile = { file: 'a.js', language: 'JavaScript', size: 1, mtimeMs: 1 };
    saveProjectIndexToSqlite(root, {
      projectMap: { root },
      fileIndex: { updatedAt: '2026-08-16T00:00:00.000Z', files: [firstFile] }
    });
    assert.equal(loadProjectIndexFromSqlite(root).fileIndex.files[0].file, 'a.js');

    getProjectDatabase(root).prepare(
      'UPDATE indexed_files SET payload_json = ? WHERE file = ?'
    ).run(JSON.stringify({ ...firstFile, file: 'stale.js' }), 'a.js');
    assert.equal(loadProjectIndexFromSqlite(root).fileIndex.files[0].file, 'a.js');

    saveProjectIndexToSqlite(root, {
      projectMap: { root },
      fileIndex: {
        updatedAt: '2026-08-16T00:00:01.000Z',
        files: [{ file: 'c.js', language: 'JavaScript', size: 1, mtimeMs: 1 }]
      }
    });
    assert.equal(loadProjectIndexFromSqlite(root).fileIndex.files[0].file, 'c.js');
  } finally {
    closeSqliteDatabasesForTests();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('project index SQLite store tolerates duplicate generated symbol ids', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-project-symbols-'));
  try {
    const duplicate = {
      symbol_id: 'src/example.js::handler',
      name: 'handler',
      kind: 'function',
      range: { start_line: 1, end_line: 1 }
    };
    assert.doesNotThrow(() => saveProjectIndexToSqlite(root, {
      projectMap: { root },
      fileIndex: {
        updatedAt: '2026-07-23T00:00:00.000Z',
        files: [
          {
            file: 'src/example.js',
            language: 'JavaScript',
            size: 1,
            mtimeMs: 1,
            symbols: [duplicate, { ...duplicate, range: { start_line: 2, end_line: 2 } }]
          }
        ]
      }
    }));
    const db = getProjectDatabase(root);
    assert.equal(
      db.prepare('SELECT count(*) AS count FROM indexed_symbols').get().count,
      2
    );
  } finally {
    closeSqliteDatabasesForTests();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('project SQLite uses performance-oriented WAL pragmas', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-project-pragmas-'));
  try {
    const db = getProjectDatabase(root);
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    assert.equal(db.prepare('PRAGMA synchronous').get().synchronous, 1);
    assert.equal(db.prepare('PRAGMA wal_autocheckpoint').get().wal_autocheckpoint, 4096);
    assert.equal(db.prepare('PRAGMA cache_size').get().cache_size, -32768);
    assert.equal(db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE name = 'indexed_search'"
    ).get().count, 0);
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index'"
    ).all().map((row) => row.name);
    assert.equal(indexes.includes('indexed_symbols_file_idx'), true);
    assert.equal(indexes.includes('indexed_files_language_idx'), false);
    assert.equal(indexes.includes('indexed_symbols_name_idx'), false);
  } finally {
    closeSqliteDatabasesForTests();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('global SQLite only keeps indexes used by current query paths', async () => {
  await withGlobalDir(async () => {
    const db = getGlobalDatabase();
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index'"
    ).all().map((row) => row.name);
    assert.equal(indexes.includes('sessions_updated_idx'), true);
    assert.equal(indexes.includes('memory_queue_list_idx'), true);
    assert.equal(indexes.includes('memory_queue_scope_idx'), true);
    assert.equal(indexes.includes('sessions_project_updated_idx'), false);
    assert.equal(indexes.includes('ui_messages_id_idx'), false);
    assert.equal(indexes.includes('memory_review_retry_idx'), false);
  });
});

test('runtime, attachment, and change oplog metadata use SQLite while payload files stay external', async () => {
  await withGlobalDir(async () => {
    setRuntimeStatus('session-meta', 'running', '2026-01-01T00:00:00.000Z');
    assert.equal(readRuntimeStatuses()['session-meta'].status, 'running');
    assert.deepEqual(recoverRuntimeStatuses(['running']), ['session-meta']);
    assert.equal(readRuntimeStatuses()['session-meta'].status, 'interrupted');
    removeRuntimeStatus('session-meta');
    assert.equal(readRuntimeStatuses()['session-meta'], undefined);

    const attachment = {
      id: 'attachment-1', path: 'C:/files/attachment-1.txt', uploadedAt: '2026-01-01T00:00:00.000Z'
    };
    saveAttachmentMetadata('session-meta', attachment);
    assert.deepEqual(loadAttachmentMetadata('session-meta', 'attachment-1'), attachment);
  });

  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-oplog-sqlite-'));
  try {
    const operation = {
      id: 'op-1', sessionId: 'session-1', createdAt: '2026-01-01T00:00:00.000Z',
      revertedAt: null, patchPath: path.join(projectRoot, 'op-1.patch'), files: []
    };
    saveChangeOperationToSqlite(projectRoot, operation);
    assert.equal(loadChangeOperationFromSqlite(projectRoot, 'op-1').patchPath, operation.patchPath);
    assert.equal(listChangeOperationsFromSqlite(projectRoot, 'session-1').length, 1);
  } finally {
    closeSqliteDatabasesForTests();
    await fs.rm(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
