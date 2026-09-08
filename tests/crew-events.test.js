import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  formatCrewStatusSummary,
  readCrewStatusPayload,
} from '../src/core/crew-snapshot.js';
import {
  appendCrewEvent,
  buildCrewCompletionEvent,
  enterCrewMode,
  listCrewEventsFromState,
  listUnreadCrewEvents,
  patchCrewWorkerRecord,
  readCrewStateFile,
  writeCrewStateFile,
} from '../src/core/crew-store.js';
import { runGit } from '../src/core/process-run.js';
import { runCrewWorkerJob } from '../src/core/crew-worker-run.js';

async function withTempDir(task) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-crew-events-'));
  try {
    return await task(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
}

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
  await fs.writeFile(path.join(dir, '.gitignore'), '.codemini/\n');
  await fs.writeFile(path.join(dir, 'README.md'), 'hello\n');
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-m', 'init']);
  await git(dir, ['branch', '-M', 'main']);
}

test('buildCrewCompletionEvent classifies worker, review, and interrupt kinds', () => {
  const done = buildCrewCompletionEvent({
    workerId: 'mia',
    status: 'completed',
    dirty: false,
    summary: 'Docs done.',
    handoffPath: '.codemini/handoffs/s/h.md',
  });
  assert.equal(done.kind, 'worker.completed');
  assert.equal(done.from, 'mia');
  assert.equal(done.to, 'coordinator');
  assert.equal(done.delivered, false);
  assert.equal(done.payload.handoffPath, '.codemini/handoffs/s/h.md');

  const review = buildCrewCompletionEvent({
    reviewOf: 'mia',
    status: 'completed',
    reviewPassed: false,
  });
  assert.equal(review.kind, 'review.completed');
  assert.equal(review.payload.reviewPassed, false);

  const interrupted = buildCrewCompletionEvent({
    workerId: 'mia',
    status: 'interrupted',
  });
  assert.equal(interrupted.kind, 'worker.interrupted');
  assert.equal(buildCrewCompletionEvent({}), null);
});

test('appendCrewEvent survives worker patches and Crew re-entry', async () => {
  await withTempDir(async (dir) => {
    await initCleanGit(dir);
    await enterCrewMode({ cwd: dir, sessionId: 'sess-1' });
    const event = buildCrewCompletionEvent({
      workerId: 'mia',
      status: 'completed',
      summary: 'Sealed.',
    });
    await appendCrewEvent(dir, event);
    await writeCrewStateFile(dir, {
      active: true,
      base: 'main',
      workers: [{
        id: 'mia',
        branch: 'codemini-crew/mia',
        worktreePath: path.join(dir, 'wt-mia'),
        runStatus: 'completed',
      }],
    });
    await patchCrewWorkerRecord(dir, 'mia', { dirty: false });
    await enterCrewMode({ cwd: dir, sessionId: 'sess-1' });

    const saved = await readCrewStateFile(dir);
    const events = listCrewEventsFromState(saved);
    assert.equal(events.length, 1);
    assert.equal(events[0].from, 'mia');
    assert.equal(events[0].kind, 'worker.completed');
    assert.equal(saved.workers[0].id, 'mia');
    assert.equal(saved.workers[0].dirty, false);
  });
});

test('crew_status lists unread completion events without treating them as pending wakes', async () => {
  await withTempDir(async (dir) => {
    const crewDir = path.join(dir, '.codemini', 'crew');
    await fs.mkdir(crewDir, { recursive: true });
    const event = buildCrewCompletionEvent({
      workerId: 'mia',
      status: 'completed',
      summary: 'Docs updated.',
    });
    await fs.writeFile(path.join(crewDir, 'state.json'), `${JSON.stringify({
      version: 1,
      active: true,
      base: 'main',
      workers: [{
        id: 'mia',
        branch: 'codemini-crew/mia',
        worktreePath: path.join(dir, 'wt-mia'),
        runStatus: 'completed',
        dirty: false,
      }],
      events: [event],
    }, null, 2)}\n`);

    const payload = await readCrewStatusPayload(dir, { inFlight: [], pendingWakes: 0 });
    assert.equal(payload.ok, true);
    assert.equal(payload.pendingWakes, 0);
    assert.equal(payload.counts.unreadEvents, 1);
    assert.equal(payload.events[0].from, 'mia');
    assert.match(payload.suggestedNext, /Dispatch reviewer/);
    const summary = formatCrewStatusSummary(payload);
    assert.match(summary, /Unread events: 1/);
    assert.match(summary, /worker\.completed/);
    assert.equal(listUnreadCrewEvents(await readCrewStateFile(dir)).length, 1);
  });
});

test('runCrewWorkerJob records a completion event before waking Crew', async () => {
  await withTempDir(async (dir) => {
    await initCleanGit(dir);
    await enterCrewMode({ cwd: dir, sessionId: 'job' });
    await writeCrewStateFile(dir, {
      workers: [{
        id: 'mia',
        branch: 'codemini-crew/mia',
        worktreePath: path.join(dir, 'wt-mia'),
        runStatus: 'running',
      }],
    });

    const wakes = [];
    const result = await runCrewWorkerJob({
      runSubAgentTask: async () => ({ text: 'Wrote docs.', artifactPaths: [] }),
      subAgentRunFailed: () => false,
      compactSubAgentResultForParent: () => 'done',
      collectPlanImplementationFileChanges: () => [],
      subAgentAllowListMayMutate: () => false,
      mergeModelUsage: () => null,
      emit: () => {},
      onWake: (text) => wakes.push(text),
      releaseInFlight: () => {},
      callId: 'call-1',
      persona: 'coder',
      policyKey: 'coder',
      taskRole: 'coder',
      title: 'docs',
      workerTask: 'write docs',
      workerWorkspaceRoot: dir,
      session: { id: 'job' },
      workspaceRoot: dir,
      config: { runtime: {} },
      resolvedTools: ['read'],
      taskPrompt: 'write docs',
      summary: 'docs',
      lockedCrewWorkerId: 'mia',
    });

    assert.equal(result.ok, true);
    assert.equal(wakes.length, 1);
    const events = listCrewEventsFromState(await readCrewStateFile(dir));
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'worker.completed');
    assert.equal(events[0].from, 'mia');
    assert.equal(events[0].delivered, false);
  });
});
