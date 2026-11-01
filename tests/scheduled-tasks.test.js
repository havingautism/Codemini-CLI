import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeTaskSchedule, nextTaskTime } from '../src/core/task-schedule.js';
import { closeSqliteDatabasesForTests, getGlobalDatabase } from '../src/core/sqlite-database.js';
import {
  saveScheduledTask, listScheduledTasks, getScheduledTask, queueScheduledTask, claimScheduledRun,
  listScheduledRuns, deleteScheduledTask, acquireScheduledWorker, recoverScheduledRuns,
  finishScheduledRun, releaseScheduledWorker, scheduledWorkerStatus, bindScheduledSession, isScheduledSessionActive,
} from '../src/core/scheduled-task-store.js';

async function isolated(t) {
  closeSqliteDatabasesForTests();
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scheduled-tasks-'));
  process.env.CODEMINI_GLOBAL_DIR = directory;
  t.after(async () => {
    closeSqliteDatabasesForTests();
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 8 });
  });
  return directory;
}
const clock = Date.parse('2026-10-31T00:00:00Z');
const taskInput = projectDir => ({ name: 'Daily review', prompt: 'Review recent changes.', mode: 'normal', projectDir,
  schedule: { type: 'interval', minutes: 10 } });

test('schedules validate intervals, explicit one-time offsets and timezone names', () => {
  for (const schedule of [{ type: 'cron' }, { type: 'interval', minutes: 0 }, { type: 'interval', minutes: 1.5 },
    { type: 'once', at: '2026-11-01T09:00' }, { type: 'daily', time: '25:00', timeZone: 'UTC' },
    { type: 'daily', time: '09:00', timeZone: 'invalid' }, { type: 'weekly', time: '09:00', timeZone: 'UTC', days: [] }]) {
    assert.throws(() => normalizeTaskSchedule(schedule));
  }
  assert.equal(normalizeTaskSchedule({ type: 'once', at: '2026-11-01T09:00:00+08:00' }).at, '2026-11-01T01:00:00.000Z');
});

test('daily and weekly occurrences follow their timezone and skip the current minute', () => {
  const daily = normalizeTaskSchedule({ type: 'daily', time: '09:00', timeZone: 'Asia/Shanghai' });
  assert.equal(nextTaskTime(daily, clock), '2026-10-31T01:00:00.000Z');
  assert.equal(nextTaskTime(daily, Date.parse('2026-10-31T01:00:00Z')), '2026-11-01T01:00:00.000Z');
  const weekly = normalizeTaskSchedule({ type: 'weekly', time: '09:00', timeZone: 'Asia/Shanghai', days: [1, 1, 5] });
  assert.deepEqual(weekly.days, [1, 5]);
  assert.equal(nextTaskTime(weekly, clock), '2026-11-02T01:00:00.000Z');
});

test('DST gaps skip the missing wall time and folds do not duplicate a claimed date', () => {
  const gap = normalizeTaskSchedule({ type: 'daily', time: '02:30', timeZone: 'America/New_York' });
  assert.equal(nextTaskTime(gap, Date.parse('2026-03-08T05:00:00Z')), '2026-03-09T06:30:00.000Z');
  const fold = normalizeTaskSchedule({ type: 'daily', time: '01:30', timeZone: 'America/New_York' });
  const first = nextTaskTime(fold, Date.parse('2026-11-01T04:00:00Z'));
  assert.equal(first, '2026-11-01T05:30:00.000Z');
  assert.equal(nextTaskTime(fold, Date.parse(first) + 1000, first), '2026-11-02T06:30:00.000Z');
});

test('saved tasks survive database reopen, preserve pause, and validate partial edits', async t => {
  const directory = await isolated(t);
  const task = saveScheduledTask(taskInput(directory), '', clock);
  closeSqliteDatabasesForTests();
  assert.equal(getScheduledTask(task.id).prompt, task.prompt);
  assert.equal(listScheduledTasks().length, 1);
  assert.equal(getGlobalDatabase().prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get().value, '20');
  saveScheduledTask({ enabled: false }, task.id, clock + 1000);
  assert.equal(getScheduledTask(task.id).nextRunAt, null);
  saveScheduledTask({ name: 'Renamed' }, task.id, clock + 2000);
  assert.equal(getScheduledTask(task.id).enabled, false);
  assert.throws(() => saveScheduledTask({ projectDir: 'relative' }, task.id, clock));
});

test('worker lease and transactional claims prevent duplicate or overlapping runs', async t => {
  const directory = await isolated(t);
  const task = saveScheduledTask(taskInput(directory), '', clock);
  assert.equal(acquireScheduledWorker('first', 1, clock, 1000), true);
  assert.equal(acquireScheduledWorker('second', 2, clock, 1000), false);
  assert.equal(scheduledWorkerStatus(clock).running, true);
  assert.equal(claimScheduledRun('second', clock + 600000), null);
  acquireScheduledWorker('first', 1, clock + 600000);
  const run = claimScheduledRun('first', clock + 600000);
  assert.equal(run.taskId, task.id);
  assert.equal(claimScheduledRun('first', clock + 600001), null);
  assert.throws(() => queueScheduledTask(task.id, clock + 600001), /already/);
  bindScheduledSession(run.id, 'session-a');
  assert.equal(isScheduledSessionActive('session-a'), true);
  assert.throws(() => deleteScheduledTask(task.id), /active run/);
  finishScheduledRun(run.id, 'completed', '', clock + 600100);
  assert.equal(isScheduledSessionActive('session-a'), false);
  assert.equal(listScheduledRuns(task.id)[0].status, 'completed');
  deleteScheduledTask(task.id);
  assert.equal(listScheduledRuns(task.id).length, 0);
});

test('missed repetitions coalesce into one run and once tasks disable after claim', async t => {
  const directory = await isolated(t);
  const repeated = saveScheduledTask(taskInput(directory), '', clock);
  const once = saveScheduledTask({ ...taskInput(directory), schedule: { type: 'once', at: new Date(clock + 5000).toISOString() } }, '', clock);
  const wake = clock + 86400000;
  acquireScheduledWorker('worker', 1, wake);
  const first = claimScheduledRun('worker', wake);
  assert.equal(first.taskId, once.id);
  assert.equal(getScheduledTask(once.id).enabled, false);
  finishScheduledRun(first.id, 'completed', '', wake);
  const second = claimScheduledRun('worker', wake);
  assert.equal(second.taskId, repeated.id);
  assert.equal(getScheduledTask(repeated.id).nextRunAt, new Date(wake + 600000).toISOString());
  finishScheduledRun(second.id, 'completed', '', wake);
  assert.equal(claimScheduledRun('worker', wake + 1), null);
});

test('manual runs keep the planned time and task snapshots isolate later edits', async t => {
  const directory = await isolated(t);
  const task = saveScheduledTask(taskInput(directory), '', clock);
  const queued = queueScheduledTask(task.id, clock);
  saveScheduledTask({ prompt: 'A new prompt' }, task.id, clock + 1000);
  acquireScheduledWorker('worker', 1, clock + 1000);
  const run = claimScheduledRun('worker', clock + 1000);
  assert.equal(run.id, queued.id);
  assert.equal(run.task.prompt, 'Review recent changes.');
  assert.equal(getScheduledTask(task.id).nextRunAt, task.nextRunAt);
});

test('a replacement worker marks orphaned executions interrupted without replaying them', async t => {
  const directory = await isolated(t);
  const task = saveScheduledTask(taskInput(directory), '', clock);
  queueScheduledTask(task.id, clock);
  acquireScheduledWorker('old', 1, clock, 1000);
  claimScheduledRun('old', clock);
  assert.equal(acquireScheduledWorker('new', 2, clock + 1001), true);
  recoverScheduledRuns('new', clock + 1001);
  assert.equal(listScheduledRuns()[0].status, 'interrupted');
  assert.equal(claimScheduledRun('new', clock + 1001), null);
  releaseScheduledWorker('old');
  assert.equal(scheduledWorkerStatus(clock + 1001).running, true);
});
