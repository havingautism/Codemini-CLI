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
  getScheduledSessionInfo, markScheduledSessionContinued,
  getScheduledChangeState,
} from '../src/core/scheduled-task-store.js';
import { registerScheduledTaskRoutes } from '../codemini-web/lib/scheduled-task-api.js';
import { buildRuntimeStateSnapshot } from '../src/core/chat-runtime.js';
import { createSession, saveSession } from '../src/core/session-store.js';
import { getSessionSidebarSnapshot } from '../codemini-web/lib/session-pages.js';

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

test('scheduler revisions ignore chat writes and heartbeats; empty running sessions appear immediately', async t => {
  const directory = await isolated(t);
  const task = saveScheduledTask(taskInput(directory), '', clock);
  const initial = getScheduledChangeState(clock);
  const session = await createSession(directory);
  await saveSession(session);
  assert.deepEqual(getScheduledChangeState(clock), initial);
  queueScheduledTask(task.id, clock);
  acquireScheduledWorker('worker', 1, clock);
  const run = claimScheduledRun('worker', clock);
  const claimed = getScheduledChangeState(clock);
  assert.equal(claimed.sessionRevision, initial.sessionRevision);
  bindScheduledSession(run.id, session.id);
  const bound = getScheduledChangeState(clock);
  assert.ok(bound.sessionRevision > claimed.sessionRevision);
  const sidebar = getSessionSidebarSnapshot([directory]);
  assert.equal(sidebar.sessions.find(entry => entry.id === session.id).scheduledStatus, 'running');
  acquireScheduledWorker('worker', 1, clock + 1000);
  assert.deepEqual(getScheduledChangeState(clock + 1000), bound);
  finishScheduledRun(run.id, 'needs_attention', 'Needs approval', clock + 2000);
  const paused = getScheduledChangeState(clock + 2000);
  assert.ok(paused.sessionRevision > bound.sessionRevision);
  // A task that pauses before writing its first message must not disappear or
  // leave a stale running row in the browser's merged sidebar.
  assert.equal(getSessionSidebarSnapshot([directory]).sessions.find(entry => entry.id === session.id).scheduledStatus, 'needs_attention');
  session.messages.push({ role: 'user', content: 'task prompt' });
  await saveSession(session);
  assert.deepEqual(getScheduledChangeState(clock + 2000), paused);
  assert.equal(getSessionSidebarSnapshot([directory]).sessions.find(entry => entry.id === session.id).scheduledStatus, 'needs_attention');
  releaseScheduledWorker('worker');
  assert.equal(getScheduledChangeState(clock + 2000).workerRunning, false);
});

test('approval modes survive edits, reopen and queued snapshots; attention hands off to chat', async t => {
  const directory = await isolated(t);
  const task = saveScheduledTask({ ...taskInput(directory), approvalMode: 'review' }, '', clock);
  const queued = queueScheduledTask(task.id, clock);
  saveScheduledTask({ approvalMode: 'full_access' }, task.id, clock);
  assert.equal(queued.task.approvalMode, 'review');
  assert.throws(() => saveScheduledTask({ approvalMode: 'invalid' }, task.id, clock), /approval mode/);
  closeSqliteDatabasesForTests();
  assert.equal(getScheduledTask(task.id).approvalMode, 'full_access');
  acquireScheduledWorker('worker', 1, clock);
  const run = claimScheduledRun('worker', clock);
  bindScheduledSession(run.id, 'scheduled-session');
  finishScheduledRun(run.id, 'needs_attention', 'This task needs tool approval.', clock + 1000);
  assert.equal(getScheduledSessionInfo('scheduled-session').task.approvalMode, 'review');
  const state = buildRuntimeStateSnapshot({ currentSession: { id: 'scheduled-session', messages: [] }, config: { execution: {} } });
  assert.match(state.scheduledAttention.reason, /tool approval/);
  markScheduledSessionContinued('scheduled-session');
  assert.equal(getScheduledSessionInfo('scheduled-session').status, 'continued');
  assert.equal(buildRuntimeStateSnapshot({ currentSession: { id: 'scheduled-session', messages: [] }, config: { execution: {} } }).scheduledAttention, null);
});

test('schema 20 tasks migrate without silently replacing the existing global approval policy', async t => {
  const directory = await isolated(t);
  const task = saveScheduledTask(taskInput(directory), '', clock);
  getGlobalDatabase().exec("ALTER TABLE scheduled_tasks DROP COLUMN approval_mode; UPDATE schema_meta SET value='20' WHERE key='schema_version'");
  closeSqliteDatabasesForTests();
  assert.equal(getScheduledTask(task.id).approvalMode, '');
  saveScheduledTask({ enabled: false }, task.id, clock);
  assert.equal(getScheduledTask(task.id).approvalMode, '');
  assert.equal(queueScheduledTask(task.id, clock).task.approvalMode, '');
});

test('task API generates emoji titles for new prompts and preserves titles on schedule-only edits', async t => {
  const directory = await isolated(t);
  const handlers = new Map();
  const routes = Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method, (path, handler) => handlers.set(`${method} ${path}`, handler)]));
  const generated = [];
  let response;
  registerScheduledTaskRoutes({ routes, nodeRoute: fn => fn, readBody: req => req.body,
    jsonResponse: (_res, data, status) => { response = { data, status }; }, generalDir: directory,
    startWorker: async () => ({ running: false }), generateTitle: async ({ userText }) => { generated.push(userText); return '📷 最新照片'; } });
  const input = { ...taskInput(directory), enabled: false, approvalMode: 'review' };
  delete input.name;
  await handlers.get('post /api/scheduled-tasks')({ body: input }, {}, new URL('http://local/api/scheduled-tasks'));
  assert.equal(response.status, 201);
  const task = response.data.task;
  assert.equal(task.name, '📷 最新照片');
  assert.equal(task.approvalMode, 'review');
  await handlers.get('put /api/scheduled-tasks/:id')({ body: { enabled: false } }, {}, new URL(`http://local/api/scheduled-tasks/${task.id}`));
  assert.equal(response.data.task.name, task.name);
  assert.deepEqual(generated, [task.prompt]);
  await handlers.get('put /api/scheduled-tasks/:id')({ body: { prompt: 'A different task' } }, {}, new URL(`http://local/api/scheduled-tasks/${task.id}`));
  assert.equal(generated.length, 2);
});

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
  assert.equal(getGlobalDatabase().prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get().value, '22');
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
