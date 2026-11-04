import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runGit } from '../src/core/process-run.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import {
  createGitOplogChangeTracker, beginGitOplogCapture, captureGitOplogChanges,
  listGitOplogChanges, undoGitOplogChange,
} from '../src/core/git-oplog-change-tracker.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-attribution-'));
  t.after(async () => {
    closeSqliteDatabasesForTests(root);
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  await runGit(['init'], { cwd: root });
  await runGit(['config', 'core.autocrlf', 'false'], { cwd: root });
  await fs.writeFile(path.join(root, 'owned.txt'), 'committed\n');
  await fs.writeFile(path.join(root, 'external.txt'), 'original\n');
  await runGit(['add', 'owned.txt', 'external.txt'], { cwd: root });
  await runGit(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'], { cwd: root });
  const tracker = await createGitOplogChangeTracker({ workspaceRoot: root, sessionId: 'session-A' });
  assert.equal(tracker.mode, 'git-oplog');
  return { root, tracker };
}

test('shell activity cannot claim concurrent external work as session A changes', async t => {
  const { root, tracker } = await fixture(t);
  for (const toolName of ['run', 'Bash', 'Powershell', 'shell']) {
    const capture = await beginGitOplogCapture(tracker, { toolName, args: { command: 'npm test' } });
    await fs.writeFile(path.join(root, 'external.txt'), `other process during ${toolName}\n`);
    const changes = await captureGitOplogChanges(tracker, capture, { toolName });
    assert.equal(changes, null);
  }
  assert.deepEqual(await listGitOplogChanges(tracker), []);
});

test('file checkpoints include only owned targets and undo preserves earlier and external edits', async t => {
  const { root, tracker } = await fixture(t);
  await fs.writeFile(path.join(root, 'owned.txt'), 'manual edit before this tool\n');
  const args = { path: 'owned.txt' };
  const capture = await beginGitOplogCapture(tracker, { toolName: 'edit', args });
  await fs.writeFile(path.join(root, 'owned.txt'), 'session A edit\n');
  await fs.writeFile(path.join(root, 'external.txt'), 'session B edit\n');
  await fs.writeFile(path.join(root, 'new-external.txt'), 'external new file\n');
  const changes = await captureGitOplogChanges(tracker, capture, {
    toolName: 'edit', args,
    declaredFileChanges: [{ path: 'owned.txt' }, { path: 'external.txt' }, { path: 'new-external.txt' }],
  });
  assert.deepEqual(changes.map(c => c.path), ['owned.txt']);
  await undoGitOplogChange(tracker, changes[0].changeSetId);
  assert.equal(await fs.readFile(path.join(root, 'owned.txt'), 'utf8'), 'manual edit before this tool\n');
  assert.equal(await fs.readFile(path.join(root, 'external.txt'), 'utf8'), 'session B edit\n');
  assert.equal(await fs.readFile(path.join(root, 'new-external.txt'), 'utf8'), 'external new file\n');
});

test('patch move owns both source and destination without scanning the repository', async t => {
  const { root, tracker } = await fixture(t);
  const args = { patch_text: '*** Begin Patch\n*** Update File: owned.txt\n*** Move to: moved.txt\n@@\n-committed\n+moved\n*** End Patch' };
  const capture = await beginGitOplogCapture(tracker, { toolName: 'apply_patch', args });
  await fs.rename(path.join(root, 'owned.txt'), path.join(root, 'moved.txt'));
  await fs.writeFile(path.join(root, 'external.txt'), 'external edit\n');
  const changes = await captureGitOplogChanges(tracker, capture, { toolName: 'apply_patch', args });
  assert.deepEqual(changes.map(c => [c.path, c.action]), [['owned.txt', 'delete'], ['moved.txt', 'create']]);
});
