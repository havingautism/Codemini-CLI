import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  beginGitOplogCapture,
  captureGitOplogChanges,
  createGitOplogChangeTracker,
  listGitOplogChanges,
  readGitOplogPatch,
  undoGitOplogChange
} from '../src/core/git-oplog-change-tracker.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import { getBuiltinTools } from '../src/core/tools.js';

test('non-git file checkpoints use the Web UI change-set contract and undo safely', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-non-git-checkpoint-'));
  const filePath = path.join(root, 'note.txt');
  t.after(async () => {
    closeSqliteDatabasesForTests();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  await fs.writeFile(filePath, 'before\n', 'utf8');
  const tracker = await createGitOplogChangeTracker({ workspaceRoot: root, sessionId: 'session-1' });
  assert.equal(tracker.mode, 'file-oplog');

  const capture = await beginGitOplogCapture(tracker, {
    toolName: 'edit',
    args: { path: 'note.txt' }
  });
  await fs.writeFile(filePath, 'after\n', 'utf8');
  const changes = await captureGitOplogChanges(tracker, capture, {
    toolName: 'edit',
    toolCallId: 'tool-1',
    args: { path: 'note.txt' }
  });

  assert.equal(changes.length, 1);
  assert.equal(changes[0].path, 'note.txt');
  assert.match(changes[0].changeSetId, /^op-/);
  assert.equal((await listGitOplogChanges(tracker)).length, 1);
  assert.match(await readGitOplogPatch(tracker, changes[0].changeSetId), /\+after/);

  await fs.writeFile(filePath, 'newer manual edit\n', 'utf8');
  await assert.rejects(
    undoGitOplogChange(tracker, changes[0].changeSetId),
    /newer edits conflict/
  );
  assert.equal(await fs.readFile(filePath, 'utf8'), 'newer manual edit\n');

  await fs.writeFile(filePath, 'after\n', 'utf8');
  assert.equal((await undoGitOplogChange(tracker, changes[0].changeSetId)).ok, true);
  assert.equal(await fs.readFile(filePath, 'utf8'), 'before\n');

  const createdCapture = await beginGitOplogCapture(tracker, {
    toolName: 'create',
    args: { path: 'created.txt' }
  });
  const createdPath = path.join(root, 'created.txt');
  await fs.writeFile(createdPath, 'created\n', 'utf8');
  const [createdChange] = await captureGitOplogChanges(tracker, createdCapture, {
    toolName: 'create',
    args: { path: 'created.txt' }
  });
  assert.equal(createdChange.action, 'create');
  await undoGitOplogChange(tracker, createdChange.changeSetId);
  await assert.rejects(fs.stat(createdPath), { code: 'ENOENT' });

  const deletedCapture = await beginGitOplogCapture(tracker, {
    toolName: 'delete',
    args: { path: 'note.txt' }
  });
  await fs.rm(filePath);
  const [deletedChange] = await captureGitOplogChanges(tracker, deletedCapture, {
    toolName: 'delete',
    args: { path: 'note.txt' }
  });
  assert.equal(deletedChange.action, 'delete');
  await undoGitOplogChange(tracker, deletedChange.changeSetId);
  assert.equal(await fs.readFile(filePath, 'utf8'), 'before\n');
});

test('non-git mutations stop before writing when the backup checkpoint fails', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-non-git-backup-failure-'));
  const tools = getBuiltinTools({
    workspaceRoot: root,
    sessionId: 'session-2',
    config: {
      context: { read_file_default_lines: 120, read_file_max_chars: 12000 },
      runtime: {},
      tools: {}
    },
    backupManager: {
      backupOnce: async () => ({ ok: false, reason: 'disk-full' })
    }
  });
  t.after(async () => {
    await tools.dispose();
    closeSqliteDatabasesForTests();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  await assert.rejects(
    tools.handlers.write({ path: 'blocked.txt', content: 'must not be written' }),
    /non-Git checkpoint failed: disk-full/
  );
  await assert.rejects(fs.stat(path.join(root, 'blocked.txt')), { code: 'ENOENT' });
});
