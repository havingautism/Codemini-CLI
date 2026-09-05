import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { createTowerCoordinator } from '../src/core/tower-coordinator.js';
import { resolveSubAgentToolAllowList } from '../src/core/chat-runtime.js';
import {
  buildTowerProgressItems,
  describeTowerWorkerProgress,
  shouldShowTowerProgressDock,
} from '../src/core/tower-progress.js';
import {
  buildTowerWorkerCompletedWake,
  compactTowerSpawnResultForParent,
  formatTowerRosterSnapshot,
  formatTowerStatusSummary,
  parseTowerReviewCompletedWake,
  parseTowerWakeHeadline,
  readTowerStatusPayload,
  resolveTowerProjectRoot,
  suggestTowerNextAction,
} from '../src/core/tower-snapshot.js';

test('formatTowerRosterSnapshot includes run and review fields', () => {
  const snapshot = formatTowerRosterSnapshot([
    {
      id: 'smoke-a',
      branch: 'codemini-tower/smoke-a',
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

test('parseTowerWakeHeadline extracts notification headline', () => {
  const wake = buildTowerWorkerCompletedWake({
    workerId: 'bob',
    status: 'completed',
    dirty: false,
    summary: 'Docs updated.',
  });
  assert.match(parseTowerWakeHeadline(wake), /Crew worker "bob" completed\./);
});

test('parseTowerReviewCompletedWake extracts the reviewed worker id', () => {
  const wake = buildTowerWorkerCompletedWake({
    workerId: 'workera',
    reviewOf: 'workera',
    status: 'completed',
    reviewPassed: true,
  });
  assert.equal(parseTowerReviewCompletedWake(wake), 'workera');
  assert.equal(parseTowerReviewCompletedWake('Tower worker "workera" completed.'), '');
});

test('compactTowerSpawnResultForParent reports background running state', () => {
  const message = compactTowerSpawnResultForParent({
    workerId: 'smoke-a',
    taskId: 'smoke-a',
    status: 'running',
    branch: 'codemini-tower/smoke-a',
    worktreePath: '/tmp/smoke-a',
  });
  assert.match(message, /spawned \(running\)/i);
  assert.match(message, /background/i);
  assert.match(message, /smoke-a/);
});

test('buildTowerWorkerCompletedWake uses notification envelope', () => {
  const wake = buildTowerWorkerCompletedWake({
    workerId: 'smoke-a',
    status: 'completed',
    dirty: false,
    summary: 'Docs updated.',
    handoffPath: '.codemini/handoffs/s1/h1.md',
  });
  assert.match(wake, /tower\.worker\.completed/);
  assert.match(wake, /Seal: sealed/);
  assert.match(wake, /Docs updated\./);
});

test('tower coordinator drains queued wakes after turn ends', async () => {
  const inFlight = new Set();
  let turnActive = true;
  const submitted = [];
  const coordinator = createTowerCoordinator({
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

test('tower coordinator does not drop a wake that lost the session claim', async () => {
  let turnActive = false;
  let busy = false;
  const submitted = [];
  const coordinator = createTowerCoordinator({
    inFlightWorkers: new Set(),
    isTurnActive: () => turnActive || busy,
    submitWake: async (text) => {
      if (busy) throw new Error('Tower wake blocked while another turn is active');
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

test('tower coordinator keeps wakes queued when submitWake fails transiently', async () => {
  let turnActive = false;
  let attempts = 0;
  const coordinator = createTowerCoordinator({
    inFlightWorkers: new Set(),
    isTurnActive: () => turnActive,
    submitWake: async () => {
      attempts += 1;
      throw new Error('Tower wake blocked while another turn is active');
    },
  });
  coordinator.enqueueWake('wake-one');
  await coordinator.drainPendingWakes();
  assert.equal(attempts, 1);
  assert.equal(coordinator.pendingWakeCount, 1);
});

test('resolveTowerProjectRoot maps worktree cwd back to project root', () => {
  const root = resolveTowerProjectRoot('/tmp/project/.codemini/tower/worktrees/workera');
  assert.equal(root, path.resolve('/tmp/project').replace(/\\/g, '/'));
});

test('suggestTowerNextAction prefers review for sealed workers', () => {
  const suggestion = suggestTowerNextAction({
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

test('suggestTowerNextAction waits for queued wakes instead of landing', () => {
  const suggestion = suggestTowerNextAction({
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

test('tower progress dock describes reviewing and hides after full merge', () => {
  const reviewing = describeTowerWorkerProgress(
    { id: 'lena', kind: 'coder', sealed: true, runStatus: 'completed', reviewPassed: undefined },
    { inFlightIds: ['lena'] },
  );
  assert.equal(reviewing.phase, 'reviewing');
  const items = buildTowerProgressItems({
    workers: [
      { id: 'lena', kind: 'coder', sealed: true, runStatus: 'completed', reviewPassed: true },
      { id: 'marco', kind: 'coder', runStatus: 'running' },
    ],
    inFlightIds: ['marco'],
  });
  assert.equal(items.find((item) => item.id === 'lena').phase, 'ready');
  assert.equal(items.find((item) => item.id === 'marco').phase, 'running');
  assert.equal(shouldShowTowerProgressDock({
    towerActive: true,
    workers: [{ id: 'lena', integrated: true, kind: 'coder' }],
    inFlightIds: [],
  }), false);
});

test('resolveSubAgentToolAllowList adds tower_status in tower sessions', () => {
  const tools = resolveSubAgentToolAllowList({ role: 'reviewer', towerSession: true });
  assert.equal(tools.includes('tower_status'), true);
});

test('readTowerStatusPayload returns live roster fields', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-tower-status-'));
  try {
    const towerDir = path.join(dir, '.codemini', 'tower');
    await fs.mkdir(towerDir, { recursive: true });
    await fs.writeFile(path.join(towerDir, 'state.json'), JSON.stringify({
      version: 1,
      active: true,
      base: 'main',
      workers: [],
    }));
    const payload = await readTowerStatusPayload(dir, { inFlight: ['worker-a'], pendingWakes: 1 });
    assert.equal(payload.ok, true);
    assert.equal(payload.base, 'main');
    assert.deepEqual(payload.inFlight, ['worker-a']);
    assert.equal(payload.pendingWakes, 1);
    assert.match(formatTowerStatusSummary(payload), /Tower base: main/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
