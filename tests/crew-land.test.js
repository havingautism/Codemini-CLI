import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { landCrewWorkers } from '../src/core/crew-land.js';
import { runGit } from '../src/core/process-run.js';
import { getProjectCrewStatePath, getProjectCrewWorktreesDir } from '../src/core/paths.js';
import { enterCrewMode, listCrewWorkersFromState, patchCrewWorkerRecord } from '../src/core/crew-store.js';
import {
  addCrewWorktree,
  composeCrewResumeTask,
  composeCrewReviewTask,
  resolveCrewReviewTarget,
  resolveCrewSubagentWorkspace,
} from '../src/core/crew-worktree.js';

async function git(cwd, args) {
  return runGit(args, {
    cwd,
    allowFailure: false,
    timeoutMs: 15_000,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Codemini Test',
      GIT_AUTHOR_EMAIL: 'crew@test.local',
      GIT_COMMITTER_NAME: 'Codemini Test',
      GIT_COMMITTER_EMAIL: 'crew@test.local',
    },
  });
}

async function initCleanGit(dir) {
  const template = path.join(dir, '.git-template');
  await fs.mkdir(template, { recursive: true });
  await git(dir, ['init', `--template=${template}`]);
  await git(dir, ['config', 'core.autocrlf', 'false']);
  await fs.writeFile(path.join(dir, '.gitignore'), '.codemini/\n');
  await fs.writeFile(path.join(dir, 'README.md'), 'hello\n');
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-m', 'init']);
  await git(dir, ['branch', '-M', 'main']);
}

async function withRepo(task) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-crew-land-'));
  try {
    await initCleanGit(dir);
    await enterCrewMode({ cwd: dir, sessionId: 'land' });
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
  await patchCrewWorkerRecord(dir, worker.id, {
    reviewedCommit: sha,
    reviewPassed: true,
    reviewText: 'Findings:\n- none',
  });
}

async function commitCount(cwd) {
  const log = await git(cwd, ['log', '--first-parent', '--format=%s']);
  return String(log.stdout || '').trim().split('\n').filter(Boolean);
}

async function listCrewRefs(cwd) {
  const result = await git(cwd, ['branch', '--list', 'codemini-crew/*']);
  return String(result.stdout || '')
    .split('\n')
    .map((line) => line.replace(/^[+*]?\s+/, '').trim())
    .filter(Boolean);
}

test('addCrewWorktree requires paths and rejects overlapping globs', async () => {
  await withRepo(async (dir) => {
    const missing = await addCrewWorktree({ cwd: dir, base: 'main', taskId: 'a' });
    assert.equal(missing.ok, false);
    assert.equal(missing.code, 'PATHS_REQUIRED');

    const first = await addCrewWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'a',
      paths: ['docs/**'],
    });
    assert.equal(first.ok, true);
    assert.deepEqual(first.worker.paths, ['docs/**']);

    const overlap = await addCrewWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'b',
      paths: ['docs/guide.md'],
    });
    assert.equal(overlap.ok, false);
    assert.equal(overlap.code, 'SCOPE_OVERLAP');

    const ok = await addCrewWorktree({
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
    const spawned = await addCrewWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'docs',
      paths: ['docs/**'],
    });
    await fs.mkdir(path.join(spawned.worker.worktreePath, 'docs'), { recursive: true });
    await fs.writeFile(path.join(spawned.worker.worktreePath, 'docs', 'a.md'), 'draft\n');
    const landed = await landCrewWorkers({ cwd: dir, base: 'main' });
    assert.equal(landed.ok, false);
    assert.equal(landed.code, 'DIRTY_WORKTREE');
    assert.deepEqual(await commitCount(dir), ['init']);
    assert.equal(await fs.access(path.join(dir, 'docs', 'a.md')).then(() => true, () => false), false);
    assert.deepEqual(await listCrewRefs(dir), ['codemini-crew/docs']);
  });
});

test('one sealed worker commits onto the user branch', async () => {
  await withRepo(async (dir) => {
    const spawned = await addCrewWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'docs',
      paths: ['docs/**'],
    });
    await commitWorkerFile(spawned.worker.worktreePath, path.join('docs', 'a.md'), 'alpha\n');
    await markCleanReview(dir, spawned.worker);
    const landed = await landCrewWorkers({ cwd: dir, base: 'main' });
    assert.equal(landed.ok, true, landed.error);
    assert.equal(landed.committed, true);
    assert.equal(await fs.readFile(path.join(dir, 'docs', 'a.md'), 'utf8'), 'alpha\n');
    const commits = await commitCount(dir);
    assert.equal(commits.length, 2);
    assert.match(commits[0], /codemini-crew merge docs/);
    const saved = JSON.parse(await fs.readFile(getProjectCrewStatePath(dir), 'utf8'));
    assert.equal(listCrewWorkersFromState(saved).length, 0);
    assert.deepEqual(landed.kept, []);
    assert.match(String(landed.message || ''), /Worker branches were deleted/);
    assert.deepEqual(await listCrewRefs(dir), []);
  });
});

test('land_workers refuses to merge after the user switches away from the recorded base branch', async () => {
  await withRepo(async (dir) => {
    const spawned = await addCrewWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'docs',
      paths: ['docs/**'],
    });
    await commitWorkerFile(spawned.worker.worktreePath, path.join('docs', 'a.md'), 'alpha\n');
    await markCleanReview(dir, spawned.worker);
    await git(dir, ['switch', '-c', 'unrelated']);

    const landed = await landCrewWorkers({ cwd: dir, base: 'main' });

    assert.equal(landed.ok, false);
    assert.equal(landed.code, 'BASE_BRANCH_MISMATCH');
    assert.equal(landed.base, 'main');
    assert.equal(landed.currentBranch, 'unrelated');
    assert.equal(await fs.access(path.join(dir, 'docs', 'a.md')).then(() => true, () => false), false);
    assert.deepEqual(await listCrewRefs(dir), ['codemini-crew/docs']);
  });
});

test('two sealed workers land both files in one crew commit', async () => {
  await withRepo(async (dir) => {
    const docs = await addCrewWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'docs',
      paths: ['docs/**'],
    });
    const src = await addCrewWorktree({
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
    const landed = await landCrewWorkers({ cwd: dir, base: 'main' });
    assert.equal(landed.ok, true, landed.error);
    assert.equal(landed.committed, true);
    assert.equal(await fs.readFile(path.join(dir, 'docs', 'a.md'), 'utf8'), 'alpha\n');
    assert.equal(await fs.readFile(path.join(dir, 'src', 'a.ts'), 'utf8'), 'export {}\n');
    const commits = await commitCount(dir);
    assert.equal(commits.length, 3);
    assert.match(commits[0], /codemini-crew merge/);
    assert.deepEqual(landed.kept, []);
    assert.deepEqual(await listCrewRefs(dir), []);
    const worktrees = await git(dir, ['worktree', 'list']);
    assert.equal(String(worktrees.stdout || '').includes('_merge-tmp'), false);
  });
});

test('land_workers refuses files outside the worker glob', async () => {
  await withRepo(async (dir) => {
    const spawned = await addCrewWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'docs',
      paths: ['docs/**'],
    });
    await commitWorkerFile(spawned.worker.worktreePath, 'escaped.txt', 'nope\n');
    const landed = await landCrewWorkers({ cwd: dir, base: 'main' });
    assert.equal(landed.ok, false);
    assert.equal(landed.code, 'SCOPE_ESCAPE');
    assert.equal(await fs.access(path.join(dir, 'escaped.txt')).then(() => true, () => false), false);
    const saved = JSON.parse(await fs.readFile(getProjectCrewStatePath(dir), 'utf8'));
    assert.equal(listCrewWorkersFromState(saved).length, 1);
    assert.deepEqual(await listCrewRefs(dir), ['codemini-crew/docs']);
  });
});

test('land_workers stops when the user worktree would overwrite uncommitted files', async () => {
  await withRepo(async (dir) => {
    const spawned = await addCrewWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'docs',
      paths: ['docs/**'],
    });
    await commitWorkerFile(spawned.worker.worktreePath, path.join('docs', 'a.md'), 'from-worker\n');
    await markCleanReview(dir, spawned.worker);
    await fs.mkdir(path.join(dir, 'docs'), { recursive: true });
    await fs.writeFile(path.join(dir, 'docs', 'a.md'), 'local\n');
    const landed = await landCrewWorkers({ cwd: dir, base: 'main' });
    assert.equal(landed.ok, false);
    assert.equal(landed.code, 'GIT_MERGE');
    assert.equal(await fs.readFile(path.join(dir, 'docs', 'a.md'), 'utf8'), 'local\n');
    const saved = JSON.parse(await fs.readFile(getProjectCrewStatePath(dir), 'utf8'));
    assert.equal(listCrewWorkersFromState(saved).length, 1);
    assert.deepEqual(await listCrewRefs(dir), ['codemini-crew/docs']);
  });
});

test('failed two-worker land keeps worker branches for retry after local checkout conflict', async () => {
  await withRepo(async (dir) => {
    const docs = await addCrewWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'docs',
      paths: ['docs/**'],
    });
    const src = await addCrewWorktree({
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
    const landed = await landCrewWorkers({ cwd: dir, base: 'main' });
    assert.equal(landed.ok, false);
    assert.equal(landed.code, 'GIT_MERGE');
    assert.equal(await fs.readFile(path.join(dir, 'docs', 'a.md'), 'utf8'), 'local\n');
    assert.equal(await fs.access(path.join(dir, 'src', 'a.ts')).then(() => true, () => false), false);
    const refs = await listCrewRefs(dir);
    assert.equal(refs.includes('codemini-crew/docs'), true);
    assert.equal(refs.includes('codemini-crew/src'), true);
    assert.equal(refs.includes('codemini-crew/_merge-tmp'), false);
    const saved = JSON.parse(await fs.readFile(getProjectCrewStatePath(dir), 'utf8'));
    const workers = listCrewWorkersFromState(saved);
    assert.equal(workers.length, 2);
    assert.equal(workers.every((item) => item.integrated === true), false);
    await fs.rm(path.join(dir, 'docs', 'a.md'));
    const retried = await landCrewWorkers({ cwd: dir, base: 'main' });
    assert.equal(retried.ok, true, retried.error);
    assert.equal(retried.committed, true);
    assert.equal(await fs.readFile(path.join(dir, 'docs', 'a.md'), 'utf8'), 'from-worker\n');
  });
});

test('land_workers refuses a sealed worker with no passing review', async () => {
  await withRepo(async (dir) => {
    const spawned = await addCrewWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'docs',
      paths: ['docs/**'],
    });
    await commitWorkerFile(spawned.worker.worktreePath, path.join('docs', 'a.md'), 'alpha\n');
    const landed = await landCrewWorkers({ cwd: dir, base: 'main' });
    assert.equal(landed.ok, false);
    assert.equal(landed.code, 'REVIEW_REQUIRED');
    assert.equal(await fs.access(path.join(dir, 'docs', 'a.md')).then(() => true, () => false), false);
    const saved = JSON.parse(await fs.readFile(getProjectCrewStatePath(dir), 'utf8'));
    assert.equal(listCrewWorkersFromState(saved).length, 1);
  });
});

test('land_workers refuses a failed review of the current commit', async () => {
  await withRepo(async (dir) => {
    const spawned = await addCrewWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'docs',
      paths: ['docs/**'],
    });
    await commitWorkerFile(spawned.worker.worktreePath, path.join('docs', 'a.md'), 'alpha\n');
    const sha = String((await git(spawned.worker.worktreePath, ['rev-parse', 'HEAD'])).stdout || '').trim();
    await patchCrewWorkerRecord(dir, spawned.worker.id, {
      reviewedCommit: sha,
      reviewPassed: false,
      reviewText: 'Findings:\n- missing tests',
    });
    const landed = await landCrewWorkers({ cwd: dir, base: 'main' });
    assert.equal(landed.ok, false);
    assert.equal(landed.code, 'REVIEW_FAILED');
  });
});

test('land_workers treats a stopped review loop like a failed review', async () => {
  await withRepo(async (dir) => {
    const spawned = await addCrewWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'docs',
      paths: ['docs/**'],
    });
    await commitWorkerFile(spawned.worker.worktreePath, path.join('docs', 'a.md'), 'alpha\n');
    const sha = String((await git(spawned.worker.worktreePath, ['rev-parse', 'HEAD'])).stdout || '').trim();
    await patchCrewWorkerRecord(dir, spawned.worker.id, {
      reviewedCommit: sha,
      reviewPassed: false,
      reviewText: 'Findings:\n- missing tests',
      reviewRound: 2,
      lastFindingsKey: 'missing tests',
      reviewLoopStopped: true,
    });
    const landed = await landCrewWorkers({ cwd: dir, base: 'main' });
    assert.equal(landed.ok, false);
    assert.equal(landed.code, 'REVIEW_FAILED');
    assert.match(String(landed.error || ''), /new task or paths/);
    assert.match(String(landed.error || ''), /Do not keep fixing the same findings/);
  });
});

test('land_workers merges a passing worker onto base while another is still in review', async () => {
  await withRepo(async (dir) => {
    const docs = await addCrewWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'docs',
      paths: ['docs/**'],
    });
    const src = await addCrewWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'src',
      paths: ['src/**'],
    });
    await commitWorkerFile(docs.worker.worktreePath, path.join('docs', 'a.md'), 'alpha\n');
    await commitWorkerFile(src.worker.worktreePath, path.join('src', 'a.ts'), 'export {}\n');
    await markCleanReview(dir, docs.worker);

    const first = await landCrewWorkers({ cwd: dir, base: 'main' });
    assert.equal(first.ok, true, first.error);
    assert.equal(first.committed, true);
    assert.deepEqual(first.integrated, ['docs']);
    assert.deepEqual(first.pending, ['src']);
    assert.equal(await fs.readFile(path.join(dir, 'docs', 'a.md'), 'utf8'), 'alpha\n');
    assert.equal((await fs.readdir(getProjectCrewWorktreesDir(dir))).includes('_merge-tmp'), false);

    const saved = JSON.parse(await fs.readFile(getProjectCrewStatePath(dir), 'utf8'));
    const workers = listCrewWorkersFromState(saved);
    assert.equal(workers.find((item) => item.id === 'docs')?.integrated, true);
    const resumeIntegrated = await resolveCrewSubagentWorkspace({
      cwd: dir,
      base: 'main',
      resume: 'docs',
    });
    assert.equal(resumeIntegrated.ok, false);
    assert.equal(resumeIntegrated.code, 'WORKER_INTEGRATED');
    const overlap = await addCrewWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'docs2',
      paths: ['docs/**'],
    });
    assert.equal(overlap.ok, true, overlap.error);

    await markCleanReview(dir, src.worker);
    const second = await landCrewWorkers({ cwd: dir, base: 'main' });
    assert.equal(second.ok, true, second.error);
    assert.equal(second.committed, true);
    assert.equal(await fs.readFile(path.join(dir, 'docs', 'a.md'), 'utf8'), 'alpha\n');
    assert.equal(await fs.readFile(path.join(dir, 'src', 'a.ts'), 'utf8'), 'export {}\n');
    const commits = await commitCount(dir);
    assert.equal(commits.length, 3);
    assert.match(commits[0], /codemini-crew merge/);
  });
});

test('a new worker commit invalidates the previous passing review', async () => {
  await withRepo(async (dir) => {
    const spawned = await addCrewWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'docs',
      paths: ['docs/**'],
    });
    await commitWorkerFile(spawned.worker.worktreePath, path.join('docs', 'a.md'), 'alpha\n');
    await markCleanReview(dir, spawned.worker);
    await commitWorkerFile(spawned.worker.worktreePath, path.join('docs', 'b.md'), 'beta\n');
    const landed = await landCrewWorkers({ cwd: dir, base: 'main' });
    assert.equal(landed.ok, false);
    assert.equal(landed.code, 'REVIEW_REQUIRED');
  });
});

test('two-worker merge conflict requires rebase onto the base tip', async () => {
  await withRepo(async (dir) => {
    const mia = await addCrewWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'mia',
      paths: ['docs/**'],
    });
    const noah = await addCrewWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'noah',
      paths: ['src/**'],
    });
    await commitWorkerFile(mia.worker.worktreePath, path.join('docs', 'a.md'), 'mia\n');
    await commitWorkerFile(noah.worker.worktreePath, path.join('src', 'a.ts'), 'export {}\n');
    await commitWorkerFile(mia.worker.worktreePath, 'README.md', 'from-mia\n');
    await commitWorkerFile(noah.worker.worktreePath, 'README.md', 'from-noah\n');
    await patchCrewWorkerRecord(dir, mia.worker.id, { paths: ['docs/**', 'README.md'] });
    await patchCrewWorkerRecord(dir, noah.worker.id, { paths: ['src/**', 'README.md'] });
    const miaRecord = { ...mia.worker, id: 'mia' };
    const noahRecord = { ...noah.worker, id: 'noah' };
    await markCleanReview(dir, miaRecord);
    await markCleanReview(dir, noahRecord);

    const landed = await landCrewWorkers({ cwd: dir, base: 'main' });
    assert.equal(landed.ok, false);
    assert.equal(landed.code, 'REBASE_REQUIRED');
    assert.equal(landed.workerId, 'noah');
    assert.equal(Boolean(landed.onto), true);
    const baseTip = String((await git(dir, ['rev-parse', 'HEAD'])).stdout || '').trim();
    assert.equal(landed.onto, baseTip);
    assert.equal((await fs.readdir(getProjectCrewWorktreesDir(dir))).includes('_merge-tmp'), false);

    const afterConflict = JSON.parse(await fs.readFile(getProjectCrewStatePath(dir), 'utf8'));
    const noahState = listCrewWorkersFromState(afterConflict).find((item) => item.id === 'noah');
    assert.equal(noahState.rebaseOnto, baseTip);
    assert.notEqual(noahState.reviewPassed, true);
    assert.equal(noahState.reviewedCommit, undefined);

    const again = await landCrewWorkers({ cwd: dir, base: 'main' });
    assert.equal(again.code, 'REBASE_REQUIRED');
    assert.equal(String((await git(dir, ['rev-parse', 'HEAD'])).stdout || '').trim(), baseTip);

    const rebase = await runGit(['rebase', baseTip], {
      cwd: noah.worker.worktreePath,
      allowFailure: true,
      timeoutMs: 15_000,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Codemini Test',
        GIT_AUTHOR_EMAIL: 'crew@test.local',
        GIT_COMMITTER_NAME: 'Codemini Test',
        GIT_COMMITTER_EMAIL: 'crew@test.local',
      },
    });
    assert.notEqual(rebase.code, 0);
    await fs.writeFile(path.join(noah.worker.worktreePath, 'README.md'), 'from-noah\n');
    await git(noah.worker.worktreePath, ['add', 'README.md']);
    await runGit(['-c', 'core.editor=true', 'rebase', '--continue'], {
      cwd: noah.worker.worktreePath,
      allowFailure: false,
      timeoutMs: 15_000,
      env: {
        ...process.env,
        GIT_EDITOR: 'true',
        GIT_AUTHOR_NAME: 'Codemini Test',
        GIT_AUTHOR_EMAIL: 'crew@test.local',
        GIT_COMMITTER_NAME: 'Codemini Test',
        GIT_COMMITTER_EMAIL: 'crew@test.local',
      },
    });

    await patchCrewWorkerRecord(dir, 'noah', { landBase: '', rebaseOnto: '' });
    await markCleanReview(dir, noahRecord);
    const finished = await landCrewWorkers({ cwd: dir, base: 'main' });
    assert.equal(finished.ok, true, finished.error);
    assert.equal((await fs.readdir(getProjectCrewWorktreesDir(dir))).includes('_merge-tmp'), false);
    assert.deepEqual(await listCrewRefs(dir), []);
  });
});

test('rebase conflict loops through resume, worker fix, review, and land', async () => {
  await withRepo(async (dir) => {
    const mia = await addCrewWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'mia',
      paths: ['docs/**'],
    });
    const noah = await addCrewWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'noah',
      paths: ['src/**'],
    });
    await commitWorkerFile(mia.worker.worktreePath, path.join('docs', 'a.md'), 'mia\n');
    await commitWorkerFile(noah.worker.worktreePath, path.join('src', 'a.ts'), 'export {}\n');
    await commitWorkerFile(mia.worker.worktreePath, 'README.md', 'from-mia\n');
    await commitWorkerFile(noah.worker.worktreePath, 'README.md', 'from-noah\n');
    await patchCrewWorkerRecord(dir, mia.worker.id, { paths: ['docs/**', 'README.md'] });
    await patchCrewWorkerRecord(dir, noah.worker.id, { paths: ['src/**', 'README.md'] });
    await markCleanReview(dir, { ...mia.worker, id: 'mia' });
    await markCleanReview(dir, { ...noah.worker, id: 'noah' });

    const conflictLand = await landCrewWorkers({ cwd: dir, base: 'main' });
    assert.equal(conflictLand.ok, false);
    assert.equal(conflictLand.code, 'REBASE_REQUIRED');
    assert.equal(conflictLand.workerId, 'noah');
    const baseTip = String((await git(dir, ['rev-parse', 'HEAD'])).stdout || '').trim();

    const afterPartial = JSON.parse(await fs.readFile(getProjectCrewStatePath(dir), 'utf8'));
    const miaState = listCrewWorkersFromState(afterPartial).find((item) => item.id === 'mia');
    const noahState = listCrewWorkersFromState(afterPartial).find((item) => item.id === 'noah');
    assert.equal(miaState.integrated, true);
    assert.equal(noahState.rebaseOnto, baseTip);
    assert.notEqual(noahState.reviewPassed, true);

    const resumed = await resolveCrewSubagentWorkspace({
      cwd: dir,
      base: 'main',
      resume: 'noah',
    });
    assert.equal(resumed.ok, true, resumed.error);
    assert.equal(resumed.resume, true);
    assert.equal(resumed.worker.worktreePath, noah.worker.worktreePath);
    const resumePrompt = composeCrewResumeTask(
      'Resolve the README conflict after mia landed',
      '# prior handoff',
      '',
      noahState.rebaseOnto,
    );
    assert.match(resumePrompt, /git rebase/);
    assert.match(resumePrompt, new RegExp(noahState.rebaseOnto));

    const rebase = await runGit(['rebase', baseTip], {
      cwd: noah.worker.worktreePath,
      allowFailure: true,
      timeoutMs: 15_000,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Codemini Test',
        GIT_AUTHOR_EMAIL: 'crew@test.local',
        GIT_COMMITTER_NAME: 'Codemini Test',
        GIT_COMMITTER_EMAIL: 'crew@test.local',
      },
    });
    assert.notEqual(rebase.code, 0);
    await fs.writeFile(path.join(noah.worker.worktreePath, 'README.md'), 'from-noah-rebased\n');
    await git(noah.worker.worktreePath, ['add', 'README.md']);
    await runGit(['-c', 'core.editor=true', 'rebase', '--continue'], {
      cwd: noah.worker.worktreePath,
      allowFailure: false,
      timeoutMs: 15_000,
      env: {
        ...process.env,
        GIT_EDITOR: 'true',
        GIT_AUTHOR_NAME: 'Codemini Test',
        GIT_AUTHOR_EMAIL: 'crew@test.local',
        GIT_COMMITTER_NAME: 'Codemini Test',
        GIT_COMMITTER_EMAIL: 'crew@test.local',
      },
    });

    const reviewTarget = await resolveCrewReviewTarget({
      cwd: dir,
      base: 'main',
      review: 'noah',
    });
    assert.equal(reviewTarget.ok, true, reviewTarget.error);
    assert.equal(reviewTarget.review, true);
    assert.equal(reviewTarget.worker.id, 'noah');
    const reviewPrompt = composeCrewReviewTask('Review the rebased README fix', {
      workerId: reviewTarget.worker.id,
      commit: reviewTarget.commit,
      paths: reviewTarget.worker.paths,
      diff: String(reviewTarget.diff || '').trim(),
      base: 'main',
    });
    assert.match(reviewPrompt, /submit_crew_review/);
    assert.match(reviewPrompt, /Review the rebased README fix/);

    await markCleanReview(dir, reviewTarget.worker);
    const finished = await landCrewWorkers({ cwd: dir, base: 'main' });
    assert.equal(finished.ok, true, finished.error);
    const readme = await fs.readFile(path.join(dir, 'README.md'), 'utf8');
    assert.equal(readme, 'from-noah-rebased\n');
    assert.equal((await fs.readdir(getProjectCrewWorktreesDir(dir))).includes('_merge-tmp'), false);
    assert.deepEqual(await listCrewRefs(dir), []);
    const saved = JSON.parse(await fs.readFile(getProjectCrewStatePath(dir), 'utf8'));
    assert.equal(listCrewWorkersFromState(saved).length, 0);
  });
});
