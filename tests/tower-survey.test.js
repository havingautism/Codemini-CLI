import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { landTowerWorkers } from '../src/core/tower-land.js';
import { runGit } from '../src/core/process-run.js';
import { runAgentLoop } from '../src/core/agent-loop.js';
import { compactSubAgentResultForParent } from '../src/core/chat-runtime.js';
import { describeTowerRunSubagent } from '../src/core/tool-display.js';
import { enterTowerMode, listTowerWorkersFromState, patchTowerWorkerRecord } from '../src/core/tower-store.js';
import {
  addTowerWorktree,
  decideTowerWorkerSeal,
  resolveTowerReviewTarget,
} from '../src/core/tower-worktree.js';

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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-tower-survey-'));
  try {
    await initCleanGit(dir);
    await enterTowerMode({ cwd: dir, sessionId: 'survey' });
    return await task(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
}

test('survey workers spawn without paths and do not occupy coder scope', async () => {
  await withRepo(async (dir) => {
    const survey = await addTowerWorktree({
      cwd: dir,
      base: 'main',
      name: 'Scout',
      kind: 'survey',
    });
    assert.equal(survey.ok, true, survey.error);
    assert.equal(survey.worker.kind, 'survey');
    assert.equal(survey.worker.paths, undefined);

    const coder = await addTowerWorktree({
      cwd: dir,
      base: 'main',
      name: 'Alisa',
      paths: ['notes.md'],
    });
    assert.equal(coder.ok, true, coder.error);

    const review = await resolveTowerReviewTarget({
      cwd: dir,
      base: 'main',
      review: survey.worker.id,
    });
    assert.equal(review.ok, false);
    assert.equal(review.code, 'SURVEY_NO_REVIEW');

    const land = await landTowerWorkers({ cwd: dir, base: 'main' });
    assert.equal(land.ok, false);
    assert.equal(land.code, 'REVIEW_REQUIRED');
    assert.equal(land.workerId, coder.worker.id);
  });
});

test('land skips survey workers when a sealed coder is ready', async () => {
  await withRepo(async (dir) => {
    const survey = await addTowerWorktree({
      cwd: dir,
      base: 'main',
      name: 'Scout',
      kind: 'survey',
    });
    const coder = await addTowerWorktree({
      cwd: dir,
      base: 'main',
      name: 'Alisa',
      paths: ['notes.md'],
    });
    await fs.writeFile(path.join(coder.worker.worktreePath, 'notes.md'), 'hello from alisa\n');
    await git(coder.worker.worktreePath, ['add', 'notes.md']);
    await git(coder.worker.worktreePath, ['commit', '-m', 'notes']);
    const sha = String((await git(coder.worker.worktreePath, ['rev-parse', 'HEAD'])).stdout || '').trim();
    await patchTowerWorkerRecord(dir, coder.worker.id, {
      reviewedCommit: sha,
      reviewPassed: true,
    });

    const landed = await landTowerWorkers({ cwd: dir, base: 'main' });
    assert.equal(landed.ok, true, landed.error);
    assert.deepEqual(landed.landed, [coder.worker.id]);
    const leftover = listTowerWorkersFromState(JSON.parse(await fs.readFile(
      path.join(dir, '.codemini', 'tower', 'state.json'),
      'utf8',
    )));
    assert.equal(leftover.some((item) => item.id === survey.worker.id), false);
  });
});

test('decideTowerWorkerSeal bounces dirty coders unless they said blocked', () => {
  assert.equal(decideTowerWorkerSeal({ dirty: false, kind: 'coder', text: 'done' }).continue, false);
  assert.equal(decideTowerWorkerSeal({ dirty: true, kind: 'coder', text: 'done' }).continue, true);
  assert.equal(decideTowerWorkerSeal({ dirty: true, kind: 'coder', text: 'blocked on types' }).continue, false);
  assert.equal(decideTowerWorkerSeal({ dirty: true, kind: 'survey', text: 'found it' }).continue, true);
  assert.equal(decideTowerWorkerSeal({ dirty: true, kind: 'coder', text: 'done', nudgeCount: 2 }).continue, false);
});

test('compactSubAgentResultForParent marks survey workers as not landable', () => {
  const text = compactSubAgentResultForParent({
    text: 'layout mapped',
    dirty: false,
    workerId: 'scout',
    workerKind: 'survey',
  });
  assert.match(text, /Survey worker/);
  assert.doesNotMatch(text, /Worktree: sealed/);
});

test('describeTowerRunSubagent labels review, survey, and worktree cards', () => {
  assert.equal(describeTowerRunSubagent({}), null);
  assert.equal(describeTowerRunSubagent({ name: 'Mira' }), null);
  assert.equal(describeTowerRunSubagent({ review: 'alisa', role: 'reviewer' }).kind, 'review');
  assert.match(describeTowerRunSubagent({ review: 'alisa', role: 'reviewer' }).label, /Tower review/);
  assert.equal(describeTowerRunSubagent({ role: 'survey', name: 'Scout' }).kind, 'survey');
  assert.equal(describeTowerRunSubagent({ name: 'Alisa', paths: ['notes.md'] }).kind, 'worker');
});

test('agent loop keeps going when shouldContinueAfterText returns a nudge', async () => {
  let calls = 0;
  const result = await runAgentLoop({
    systemPrompt: 'sys',
    userPrompt: 'finish the slice',
    model: 'test-model',
    requestCompletion: async () => {
      calls += 1;
      return { text: calls === 1 ? 'done' : 'committed', toolCalls: [] };
    },
    skipAnalysisNudge: true,
    approvalMode: 'full_access',
    shouldContinueAfterText: async (text) => (String(text) === 'done' ? 'git commit now' : null),
  });
  assert.equal(calls, 2);
  assert.equal(result.text, 'committed');
});
