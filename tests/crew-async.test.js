import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { createCrewCoordinator } from '../src/core/crew-coordinator.js';
import { resolveSubAgentToolAllowList } from '../src/core/chat-runtime.js';
import {
  buildCrewProgressItems,
  describeCrewWorkerProgress,
  shouldShowCrewProgressDock,
} from '../src/core/crew-progress.js';
import {
  buildCrewWorkerCompletedWake,
  compactCrewSpawnResultForParent,
  formatCrewRosterSnapshot,
  formatCrewStatusSummary,
  parseCrewReviewCompletedWake,
  parseCrewWakeHeadline,
  readCrewStatusPayload,
  resolveCrewProjectRoot,
  suggestCrewNextAction,
} from '../src/core/crew-snapshot.js';

test('formatCrewRosterSnapshot includes run and review fields', () => {
  const snapshot = formatCrewRosterSnapshot([
    {
      id: 'smoke-a',
      branch: 'codemini-crew/smoke-a',
      worktreePath: '/tmp/smoke-a',
      paths: ['docs/**'],
      runStatus: 'running',
      dirty: false,
      reviewPassed: true,
      lastHandoffPath: '.codemini/handoffs/s1/h1.md',
    },
  ]);
  assert.match(snapshot, /smoke-a/);
  assert.match(snapshot, /run=running/);
  assert.match(snapshot, /review=pass/);
  assert.match(snapshot, /handoff=/);
});

test('parseCrewWakeHeadline extracts notification headline', () => {
  const wake = buildCrewWorkerCompletedWake({
    workerId: 'bob',
    status: 'completed',
    dirty: false,
    summary: 'Docs updated.',
  });
  assert.match(parseCrewWakeHeadline(wake), /Crew worker "bob" completed\./);
});

test('parseCrewReviewCompletedWake extracts the reviewed worker id', () => {
  const wake = buildCrewWorkerCompletedWake({
    workerId: 'workera',
    reviewOf: 'workera',
    status: 'completed',
    reviewPassed: true,
  });
  assert.equal(parseCrewReviewCompletedWake(wake), 'workera');
  assert.equal(parseCrewReviewCompletedWake('Crew worker "workera" completed.'), '');
});

test('compactCrewSpawnResultForParent reports background running state', () => {
  const message = compactCrewSpawnResultForParent({
    workerId: 'smoke-a',
    taskId: 'smoke-a',
    status: 'running',
    branch: 'codemini-crew/smoke-a',
    worktreePath: '/tmp/smoke-a',
  });
  assert.match(message, /spawned \(running\)/i);
  assert.match(message, /background/i);
  assert.match(message, /smoke-a/);
});

test('buildCrewWorkerCompletedWake uses notification envelope', () => {
  const wake = buildCrewWorkerCompletedWake({
    workerId: 'smoke-a',
    status: 'completed',
    dirty: false,
    summary: 'Docs updated.',
    handoffPath: '.codemini/handoffs/s1/h1.md',
  });
  assert.match(wake, /crew\.worker\.completed/);
  assert.match(wake, /Seal: sealed/);
  assert.match(wake, /Docs updated\./);
});

test('crew coordinator drains queued wakes after turn ends', async () => {
  const inFlight = new Set();
  let turnActive = true;
  const submitted = [];
  const coordinator = createCrewCoordinator({
    inFlightWorkers: inFlight,
    isTurnActive: () => turnActive,
    submitWake: async (text) => {
      submitted.push(text);
    },
  });
  coordinator.enqueueWake('wake-one');
  coordinator.enqueueWake('wake-two');
  assert.equal(submitted.length, 0);
  turnActive = false;
  await coordinator.drainPendingWakes();
  assert.deepEqual(submitted, ['wake-one', 'wake-two']);
});

test('crew coordinator does not drop a wake that lost the session claim', async () => {
  let turnActive = false;
  let busy = false;
  const submitted = [];
  const coordinator = createCrewCoordinator({
    inFlightWorkers: new Set(),
    isTurnActive: () => turnActive || busy,
    submitWake: async (text) => {
      if (busy) throw new Error('Crew wake blocked while another turn is active');
      busy = true;
      submitted.push(text);
      busy = false;
    },
  });
  busy = true;
  coordinator.enqueueWake('wake-during-user-turn');
  assert.equal(submitted.length, 0);
  assert.equal(coordinator.pendingWakeCount, 1);
  busy = false;
  await coordinator.drainPendingWakes();
  assert.deepEqual(submitted, ['wake-during-user-turn']);
});

test('crew coordinator keeps wakes queued when submitWake fails transiently', async () => {
  let turnActive = false;
  let attempts = 0;
  const coordinator = createCrewCoordinator({
    inFlightWorkers: new Set(),
    isTurnActive: () => turnActive,
    submitWake: async () => {
      attempts += 1;
      throw new Error('Crew wake blocked while another turn is active');
    },
  });
  coordinator.enqueueWake('wake-one');
  await coordinator.drainPendingWakes();
  assert.equal(attempts, 1);
  assert.equal(coordinator.pendingWakeCount, 1);
});

test('resolveCrewProjectRoot maps worktree cwd back to project root', () => {
  const root = resolveCrewProjectRoot('/tmp/project/.codemini/crew/worktrees/workera');
  assert.equal(root, path.resolve('/tmp/project').replace(/\\/g, '/'));
});

test('suggestCrewNextAction prefers review for sealed workers', () => {
  const suggestion = suggestCrewNextAction({
    workers: [{
      id: 'workera',
      sealed: true,
      kind: 'coder',
      reviewPassed: undefined,
      integrated: false,
    }],
    inFlight: [],
  });
  assert.match(suggestion, /reviewer/i);
  assert.match(suggestion, /workera/);
});

test('suggestCrewNextAction waits for queued wakes instead of landing', () => {
  const suggestion = suggestCrewNextAction({
    workers: [{
      id: 'lena',
      sealed: true,
      kind: 'coder',
      reviewPassed: true,
      integrated: false,
    }],
    inFlight: [],
    pendingWakes: 1,
  });
  assert.match(suggestion, /queued/i);
  assert.doesNotMatch(suggestion, /land_workers/i);
});

test('crew progress dock describes reviewing and hides after full merge', () => {
  const reviewing = describeCrewWorkerProgress(
    { id: 'lena', kind: 'coder', sealed: true, runStatus: 'completed', reviewPassed: undefined },
    { inFlightIds: ['lena'] },
  );
  assert.equal(reviewing.phase, 'reviewing');
  const items = buildCrewProgressItems({
    workers: [
      { id: 'lena', kind: 'coder', sealed: true, runStatus: 'completed', reviewPassed: true },
      { id: 'marco', kind: 'coder', runStatus: 'running' },
    ],
    inFlightIds: ['marco'],
  });
  assert.equal(items.find((item) => item.id === 'lena').phase, 'ready');
  assert.equal(items.find((item) => item.id === 'marco').phase, 'running');
  assert.equal(shouldShowCrewProgressDock({
    crewActive: true,
    workers: [{ id: 'lena', integrated: true, kind: 'coder' }],
    inFlightIds: [],
  }), false);
});

test('resolveSubAgentToolAllowList adds crew_status in crew sessions', () => {
  const tools = resolveSubAgentToolAllowList({ role: 'reviewer', crewSession: true });
  assert.equal(tools.includes('crew_status'), true);
  assert.equal(tools.includes('cancel_worker'), false);
});

test('readCrewStatusPayload returns live roster fields', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-crew-status-'));
  try {
    const crewDir = path.join(dir, '.codemini', 'crew');
    await fs.mkdir(crewDir, { recursive: true });
    await fs.writeFile(path.join(crewDir, 'state.json'), JSON.stringify({
      version: 1,
      active: true,
      base: 'main',
      workers: [],
    }));
    const payload = await readCrewStatusPayload(dir, { inFlight: ['worker-a'], pendingWakes: 1 });
    assert.equal(payload.ok, true);
    assert.equal(payload.base, 'main');
    assert.deepEqual(payload.inFlight, ['worker-a']);
    assert.equal(payload.pendingWakes, 1);
    assert.match(formatCrewStatusSummary(payload), /Crew base: main/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
