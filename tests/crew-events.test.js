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
import { dropCrewWorkerFromLedger, finishCrewMissions } from '../src/core/crew-missions.js';

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
        missionId: 'm1',
        runStatus: 'completed',
        dirty: false,
      }],
      missions: [{
        id: 'm1',
        title: 'docs',
        kind: 'build',
        status: 'completed',
        workerId: 'mia',
        paths: ['docs/**'],
      }],
      events: [event],
    }, null, 2)}\n`);

    const payload = await readCrewStatusPayload(dir, { inFlight: [], pendingWakes: 0 });
    assert.equal(payload.ok, true);
    assert.equal(payload.pendingWakes, 0);
    assert.equal(payload.counts.unreadEvents, 1);
    assert.equal(payload.events[0].from, 'mia');
    assert.match(payload.suggestedNext, /Dispatch a reviewer/);
    const summary = formatCrewStatusSummary(payload);
    assert.match(summary, /Unread events: 1/);
    assert.match(summary, /worker\.completed/);
    assert.equal(listUnreadCrewEvents(await readCrewStateFile(dir)).length, 0);
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
    assert.equal(events[0].kind, 'worker.interrupted');
    assert.equal(events[0].from, 'mia');
    assert.equal(events[0].delivered, false);
  });
});

function crewEvent(id, from, delivered) {
  return {
    id,
    kind: 'worker.completed',
    from,
    to: 'coordinator',
    at: '2026-11-17T18:00:00.000Z',
    delivered,
    payload: { summary: id },
  };
}

test('crew_finish drops completion events once no missions remain', async () => {
  await withTempDir(async (dir) => {
    const crewDir = path.join(dir, '.codemini', 'crew');
    await fs.mkdir(crewDir, { recursive: true });
    await fs.writeFile(path.join(crewDir, 'state.json'), JSON.stringify({
      version: 1,
      active: true,
      base: 'main',
      workers: [{
        id: 'w1',
        branch: 'codemini-crew/w1',
        worktreePath: path.join(dir, 'missing-wt'),
        missionId: 'm1',
      }],
      missions: [{
        id: 'm1',
        title: 'Done',
        kind: 'build',
        status: 'merged',
        workerId: 'w1',
        paths: ['src/**'],
      }],
      events: [crewEvent('e1', 'w1', true), crewEvent('e2', 'w1', false)],
    }));
    const finish = await finishCrewMissions({ cwd: dir, inFlight: [] });
    assert.equal(finish.ok, true, finish.error || finish.message);
    const state = await readCrewStateFile(dir);
    assert.equal(state.missions.length, 0);
    assert.equal(state.workers.length, 0);
    assert.equal(listCrewEventsFromState(state).length, 0);
  });
});

test('crew_finish on an already empty ledger drops leftover events', async () => {
  await withTempDir(async (dir) => {
    const crewDir = path.join(dir, '.codemini', 'crew');
    await fs.mkdir(crewDir, { recursive: true });
    await fs.writeFile(path.join(crewDir, 'state.json'), JSON.stringify({
      version: 1,
      active: true,
      base: 'main',
      workers: [],
      missions: [],
      events: [crewEvent('old', 'wkr_gone', true)],
    }));
    const finish = await finishCrewMissions({ cwd: dir, inFlight: [] });
    assert.equal(finish.ok, true);
    assert.match(finish.message, /already clean/i);
    assert.equal(listCrewEventsFromState(await readCrewStateFile(dir)).length, 0);
  });
});

test('crew_finish keeps events while a mission remains', async () => {
  await withTempDir(async (dir) => {
    const kept = path.join(dir, 'kept-wt');
    await fs.mkdir(kept, { recursive: true });
    await git(kept, ['init']);
    await fs.writeFile(path.join(kept, 'dirty.txt'), 'x\n');
    const crewDir = path.join(dir, '.codemini', 'crew');
    await fs.mkdir(crewDir, { recursive: true });
    await fs.writeFile(path.join(crewDir, 'state.json'), JSON.stringify({
      version: 1,
      active: true,
      base: 'main',
      workers: [
        {
          id: 'gone',
          branch: 'codemini-crew/gone',
          worktreePath: path.join(dir, 'missing-wt'),
          missionId: 'm1',
        },
        {
          id: 'kept',
          branch: 'codemini-crew/kept',
          worktreePath: kept,
          missionId: 'm2',
        },
      ],
      missions: [
        {
          id: 'm1',
          title: 'Gone',
          kind: 'build',
          status: 'merged',
          workerId: 'gone',
          paths: ['src/**'],
        },
        {
          id: 'm2',
          title: 'Kept',
          kind: 'build',
          status: 'merged',
          workerId: 'kept',
          paths: ['docs/**'],
        },
      ],
      events: [crewEvent('e-gone', 'gone', true), crewEvent('e-kept', 'kept', false)],
    }));
    const finish = await finishCrewMissions({ cwd: dir, inFlight: [] });
    assert.equal(finish.ok, true, finish.error || finish.message);
    assert.equal(finish.kept.length, 1);
    const state = await readCrewStateFile(dir);
    assert.equal(state.missions.length, 1);
    assert.deepEqual(listCrewEventsFromState(state).map((event) => event.id), ['e-gone', 'e-kept']);
  });
});

test('cancelling the last worker drops its completion events', async () => {
  await withTempDir(async (dir) => {
    const crewDir = path.join(dir, '.codemini', 'crew');
    await fs.mkdir(crewDir, { recursive: true });
    await fs.writeFile(path.join(crewDir, 'state.json'), JSON.stringify({
      version: 1,
      active: true,
      base: 'main',
      workers: [{
        id: 'w1',
        branch: 'codemini-crew/w1',
        worktreePath: path.join(dir, 'missing-wt'),
        missionId: 'm1',
      }],
      missions: [{
        id: 'm1',
        title: 'Drop',
        kind: 'build',
        status: 'active',
        workerId: 'w1',
        paths: ['src/**'],
      }],
      events: [crewEvent('e1', 'w1', true)],
    }));
    await dropCrewWorkerFromLedger(dir, 'w1');
    const state = await readCrewStateFile(dir);
    assert.equal(state.missions.length, 0);
    assert.equal(listCrewEventsFromState(state).length, 0);
  });
});
