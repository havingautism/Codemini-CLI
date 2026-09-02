import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { landTowerWorkers } from '../src/core/tower-land.js';
import { runGit } from '../src/core/process-run.js';
import { getProjectTowerStatePath } from '../src/core/paths.js';
import { enterTowerMode, listTowerWorkersFromState, patchTowerWorkerRecord } from '../src/core/tower-store.js';
import { addTowerWorktree } from '../src/core/tower-worktree.js';

async function git(cwd, args) {
  return runGit(args, {
    cwd,
    allowFailure: false,
    timeoutMs: 15_000,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Codemini Test',
      GIT_AUTHOR_EMAIL: 'tower@test.local',
      GIT_COMMITTER_NAME: 'Codemini Test',
      GIT_COMMITTER_EMAIL: 'tower@test.local',
    },
  });
}

async function initCleanGit(dir) {
  const template = path.join(dir, '.git-template');
  await fs.mkdir(template, { recursive: true });
  await git(dir, ['init', `--template=${template}`]);
  await fs.writeFile(path.join(dir, '.gitignore'), '.codemini/\n');
  await fs.writeFile(path.join(dir, 'README.md'), 'hello\n');
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-m', 'init']);
  await git(dir, ['branch', '-M', 'main']);
}

async function withRepo(task) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-tower-land-'));
  try {
    await initCleanGit(dir);
    await enterTowerMode({ cwd: dir, sessionId: 'land' });
    return await task(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
}

async function commitWorkerFile(worktreePath, relative, content) {
  const full = path.join(worktreePath, relative);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
  await git(worktreePath, ['add', relative]);
  await git(worktreePath, ['commit', '-m', `add ${relative}`]);
}

async function markCleanReview(dir, worker) {
  const sha = String((await git(worker.worktreePath, ['rev-parse', 'HEAD'])).stdout || '').trim();
  await patchTowerWorkerRecord(dir, worker.id, {
    reviewedCommit: sha,
    reviewPassed: true,
    reviewText: 'Findings:\n- none',
  });
}

async function commitCount(cwd) {
  const log = await git(cwd, ['log', '--format=%s']);
  return String(log.stdout || '').trim().split('\n').filter(Boolean);
}

async function listTowerRefs(cwd) {
  const result = await git(cwd, ['branch', '--list', 'codemini-tower/*']);
  return String(result.stdout || '')
    .split('\n')
    .map((line) => line.replace(/^[+*]?\s+/, '').trim())
    .filter(Boolean);
}

test('addTowerWorktree requires paths and rejects overlapping globs', async () => {
  await withRepo(async (dir) => {
    const missing = await addTowerWorktree({ cwd: dir, base: 'main', taskId: 'a' });
    assert.equal(missing.ok, false);
    assert.equal(missing.code, 'PATHS_REQUIRED');

    const first = await addTowerWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'a',
      paths: ['docs/**'],
    });
    assert.equal(first.ok, true);
    assert.deepEqual(first.worker.paths, ['docs/**']);

    const overlap = await addTowerWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'b',
      paths: ['docs/guide.md'],
    });
    assert.equal(overlap.ok, false);
    assert.equal(overlap.code, 'SCOPE_OVERLAP');

    const ok = await addTowerWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'b',
      paths: ['src/**'],
    });
    assert.equal(ok.ok, true);
  });
});

test('land_workers refuses a dirty worker worktree and does not commit the user branch', async () => {
  await withRepo(async (dir) => {
    const spawned = await addTowerWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'docs',
      paths: ['docs/**'],
    });
    await fs.mkdir(path.join(spawned.worker.worktreePath, 'docs'), { recursive: true });
    await fs.writeFile(path.join(spawned.worker.worktreePath, 'docs', 'a.md'), 'draft\n');
    const landed = await landTowerWorkers({ cwd: dir, base: 'main' });
    assert.equal(landed.ok, false);
    assert.equal(landed.code, 'DIRTY_WORKTREE');
    assert.deepEqual(await commitCount(dir), ['init']);
    assert.equal(await fs.access(path.join(dir, 'docs', 'a.md')).then(() => true, () => false), false);
    assert.deepEqual(await listTowerRefs(dir), ['codemini-tower/docs']);
  });
});

test('one sealed worker squashes onto the user branch without a merge commit', async () => {
  await withRepo(async (dir) => {
    const spawned = await addTowerWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'docs',
      paths: ['docs/**'],
    });
    await commitWorkerFile(spawned.worker.worktreePath, path.join('docs', 'a.md'), 'alpha\n');
    await markCleanReview(dir, spawned.worker);
    const landed = await landTowerWorkers({ cwd: dir, base: 'main' });
    assert.equal(landed.ok, true, landed.error);
    assert.equal(await fs.readFile(path.join(dir, 'docs', 'a.md'), 'utf8'), 'alpha\n');
    assert.deepEqual(await commitCount(dir), ['init']);
    const saved = JSON.parse(await fs.readFile(getProjectTowerStatePath(dir), 'utf8'));
    assert.equal(listTowerWorkersFromState(saved).length, 0);
    assert.deepEqual(landed.kept, []);
    assert.match(String(landed.message || ''), /Worker branches were deleted/);
    assert.deepEqual(await listTowerRefs(dir), []);
  });
});

test('two sealed workers squash both files without a user merge commit', async () => {
  await withRepo(async (dir) => {
    const docs = await addTowerWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'docs',
      paths: ['docs/**'],
    });
    const src = await addTowerWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'src',
      paths: ['src/**'],
      dependsOn: ['docs'],
    });
    await commitWorkerFile(docs.worker.worktreePath, path.join('docs', 'a.md'), 'alpha\n');
    await commitWorkerFile(src.worker.worktreePath, path.join('src', 'a.ts'), 'export {}\n');
    await markCleanReview(dir, docs.worker);
    await markCleanReview(dir, src.worker);
    const landed = await landTowerWorkers({ cwd: dir, base: 'main' });
    assert.equal(landed.ok, true, landed.error);
    assert.equal(await fs.readFile(path.join(dir, 'docs', 'a.md'), 'utf8'), 'alpha\n');
    assert.equal(await fs.readFile(path.join(dir, 'src', 'a.ts'), 'utf8'), 'export {}\n');
    assert.deepEqual(await commitCount(dir), ['init']);
    assert.deepEqual(landed.kept, []);
    assert.deepEqual(await listTowerRefs(dir), []);
    const worktrees = await git(dir, ['worktree', 'list']);
    assert.equal(String(worktrees.stdout || '').includes('_merge-tmp'), false);
  });
});

test('land_workers refuses files outside the worker glob', async () => {
  await withRepo(async (dir) => {
    const spawned = await addTowerWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'docs',
      paths: ['docs/**'],
    });
    await commitWorkerFile(spawned.worker.worktreePath, 'escaped.txt', 'nope\n');
    const landed = await landTowerWorkers({ cwd: dir, base: 'main' });
    assert.equal(landed.ok, false);
    assert.equal(landed.code, 'SCOPE_ESCAPE');
    assert.equal(await fs.access(path.join(dir, 'escaped.txt')).then(() => true, () => false), false);
    const saved = JSON.parse(await fs.readFile(getProjectTowerStatePath(dir), 'utf8'));
    assert.equal(listTowerWorkersFromState(saved).length, 1);
    assert.deepEqual(await listTowerRefs(dir), ['codemini-tower/docs']);
  });
});

test('land_workers stops when the user worktree would overwrite uncommitted files', async () => {
  await withRepo(async (dir) => {
    const spawned = await addTowerWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'docs',
      paths: ['docs/**'],
    });
    await commitWorkerFile(spawned.worker.worktreePath, path.join('docs', 'a.md'), 'from-worker\n');
    await markCleanReview(dir, spawned.worker);
    await fs.mkdir(path.join(dir, 'docs'), { recursive: true });
    await fs.writeFile(path.join(dir, 'docs', 'a.md'), 'local\n');
    const landed = await landTowerWorkers({ cwd: dir, base: 'main' });
    assert.equal(landed.ok, false);
    assert.equal(await fs.readFile(path.join(dir, 'docs', 'a.md'), 'utf8'), 'local\n');
    const saved = JSON.parse(await fs.readFile(getProjectTowerStatePath(dir), 'utf8'));
    assert.equal(listTowerWorkersFromState(saved).length, 1);
    assert.deepEqual(await listTowerRefs(dir), ['codemini-tower/docs']);
  });
});

test('failed two-worker squash keeps worker branches and deletes merge tmp', async () => {
  await withRepo(async (dir) => {
    const docs = await addTowerWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'docs',
      paths: ['docs/**'],
    });
    const src = await addTowerWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'src',
      paths: ['src/**'],
    });
    await commitWorkerFile(docs.worker.worktreePath, path.join('docs', 'a.md'), 'from-worker\n');
    await commitWorkerFile(src.worker.worktreePath, path.join('src', 'a.ts'), 'export {}\n');
    await markCleanReview(dir, docs.worker);
    await markCleanReview(dir, src.worker);
    await fs.mkdir(path.join(dir, 'docs'), { recursive: true });
    await fs.writeFile(path.join(dir, 'docs', 'a.md'), 'local\n');
    const landed = await landTowerWorkers({ cwd: dir, base: 'main' });
    assert.equal(landed.ok, false);
    assert.equal(await fs.readFile(path.join(dir, 'docs', 'a.md'), 'utf8'), 'local\n');
    assert.equal(await fs.access(path.join(dir, 'src', 'a.ts')).then(() => true, () => false), false);
    const refs = await listTowerRefs(dir);
    assert.equal(refs.includes('codemini-tower/docs'), true);
    assert.equal(refs.includes('codemini-tower/src'), true);
    assert.equal(refs.some((name) => name.includes('merge-tmp') || name.endsWith('/tmp')), false);
    const saved = JSON.parse(await fs.readFile(getProjectTowerStatePath(dir), 'utf8'));
    assert.equal(listTowerWorkersFromState(saved).length, 2);
  });
});

test('land_workers refuses a sealed worker with no passing review', async () => {
  await withRepo(async (dir) => {
    const spawned = await addTowerWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'docs',
      paths: ['docs/**'],
    });
    await commitWorkerFile(spawned.worker.worktreePath, path.join('docs', 'a.md'), 'alpha\n');
    const landed = await landTowerWorkers({ cwd: dir, base: 'main' });
    assert.equal(landed.ok, false);
    assert.equal(landed.code, 'REVIEW_REQUIRED');
    assert.equal(await fs.access(path.join(dir, 'docs', 'a.md')).then(() => true, () => false), false);
    const saved = JSON.parse(await fs.readFile(getProjectTowerStatePath(dir), 'utf8'));
    assert.equal(listTowerWorkersFromState(saved).length, 1);
  });
});

test('land_workers refuses a failed review of the current commit', async () => {
  await withRepo(async (dir) => {
    const spawned = await addTowerWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'docs',
      paths: ['docs/**'],
    });
    await commitWorkerFile(spawned.worker.worktreePath, path.join('docs', 'a.md'), 'alpha\n');
    const sha = String((await git(spawned.worker.worktreePath, ['rev-parse', 'HEAD'])).stdout || '').trim();
    await patchTowerWorkerRecord(dir, spawned.worker.id, {
      reviewedCommit: sha,
      reviewPassed: false,
      reviewText: 'Findings:\n- missing tests',
    });
    const landed = await landTowerWorkers({ cwd: dir, base: 'main' });
    assert.equal(landed.ok, false);
    assert.equal(landed.code, 'REVIEW_FAILED');
  });
});

test('a new worker commit invalidates the previous passing review', async () => {
  await withRepo(async (dir) => {
    const spawned = await addTowerWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'docs',
      paths: ['docs/**'],
    });
    await commitWorkerFile(spawned.worker.worktreePath, path.join('docs', 'a.md'), 'alpha\n');
    await markCleanReview(dir, spawned.worker);
    await commitWorkerFile(spawned.worker.worktreePath, path.join('docs', 'b.md'), 'beta\n');
    const landed = await landTowerWorkers({ cwd: dir, base: 'main' });
    assert.equal(landed.ok, false);
    assert.equal(landed.code, 'REVIEW_REQUIRED');
  });
});
