import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createScheduledTaskForm, latestScheduledRuns, scheduledFrequencyLabel, scheduledTaskFormPayload,
  scheduledTaskNeedsReschedule, scheduledTaskState, scheduledTaskTone, visibleScheduledRuns, visibleScheduledTasks,
} from '../codemini-web/client/src/lib/scheduled-task-ui.js';
import { fetchScheduledTasks } from '../codemini-web/client/src/hooks/use-api.js';

const tasks = [
  { id: 'paused', name: 'Z review', prompt: 'Review source', projectDir: 'C:/repo', enabled: false, schedule: { type: 'daily', time: '09:00', timeZone: 'Asia/Shanghai' }, updatedAt: '2026-11-01T02:00:00Z' },
  { id: 'soon', name: 'A morning', prompt: 'Summarize notes', projectDir: 'C:/notes', enabled: true, schedule: { type: 'daily', time: '09:00', timeZone: 'Asia/Shanghai' }, nextRunAt: '2026-11-02T01:00:00Z', updatedAt: '2026-11-01T00:00:00Z' },
  { id: 'later', name: 'B afternoon', prompt: 'Check tests', projectDir: 'C:/repo', enabled: true, schedule: { type: 'interval', minutes: 60 }, nextRunAt: '2026-11-02T02:00:00Z', updatedAt: '2026-11-01T01:00:00Z' },
  { id: 'once', name: 'One-time', prompt: 'Read', projectDir: 'C:/repo', enabled: false, schedule: { type: 'once', at: '2026-10-31T00:00:30.123Z' }, updatedAt: '2026-10-31T00:00:00Z' },
];
const runs = [
  { id: 'old', taskId: 'later', status: 'failed', error: 'old failure', createdAt: '2026-10-30T00:00:00Z', task: tasks[2] },
  { id: 'done', taskId: 'once', status: 'completed', createdAt: '2026-10-31T00:00:00Z', task: tasks[3] },
  { id: 'new', taskId: 'later', status: 'needs_attention', error: 'Need approval', createdAt: '2026-11-01T00:00:00Z', task: tasks[2] },
];

test('task library filters combine search with enabled, paused and attention state', () => {
  assert.deepEqual(visibleScheduledTasks(tasks, runs, { filter: 'enabled' }).map(task => task.id), ['soon', 'later']);
  assert.deepEqual(visibleScheduledTasks(tasks, runs, { filter: 'paused' }).map(task => task.id), ['paused']);
  assert.deepEqual(visibleScheduledTasks(tasks, runs, { filter: 'attention', query: ' TESTS ' }).map(task => task.id), ['later']);
  assert.deepEqual(visibleScheduledTasks(tasks, runs, { query: 'c:/notes' }).map(task => task.id), ['soon']);
  assert.deepEqual(visibleScheduledTasks(tasks, runs, { filter: 'enabled', query: 'no match' }), []);
});

test('task library sorting puts disabled tasks after actual upcoming runs without mutating data', () => {
  const original = tasks.map(task => task.id);
  assert.deepEqual(visibleScheduledTasks(tasks, runs).map(task => task.id).slice(0, 2), ['soon', 'later']);
  assert.equal(visibleScheduledTasks(tasks, runs, { sort: 'recent' })[0].id, 'paused');
  assert.equal(visibleScheduledTasks(tasks, runs, { sort: 'title' })[0].id, 'soon');
  assert.deepEqual(tasks.map(task => task.id), original);
});

test('a completed one-time task is not mislabeled paused and running work wins over pause', () => {
  assert.equal(scheduledTaskState(tasks[3], runs[1]), 'completed');
  assert.equal(scheduledTaskState(tasks[0], { status: 'running' }), 'running');
  assert.equal(scheduledTaskState(tasks[0], { status: 'failed' }), 'failed');
  assert.equal(scheduledTaskState(tasks[0]), 'paused');
  assert.equal(scheduledTaskState(tasks[1], { status: 'completed' }), 'enabled');
  assert.equal(latestScheduledRuns(runs).get('later').id, 'new');
});

test('run history can be searched by task context or actionable error', () => {
  assert.deepEqual(visibleScheduledRuns(runs, 'APPROVAL').map(run => run.id), ['new']);
  assert.deepEqual(visibleScheduledRuns(runs, 'One-time').map(run => run.id), ['done']);
});

test('editing a paused task preserves its state, mode, project and timezone', () => {
  const task = { ...tasks[0], mode: 'plan' };
  const form = createScheduledTaskForm(task, 'C:/another');
  form.name = 'Renamed';
  const payload = scheduledTaskFormPayload(form, task);
  assert.equal(payload.enabled, false);
  assert.equal(payload.mode, 'plan');
  assert.equal(payload.projectDir, 'C:/repo');
  assert.deepEqual(payload.schedule, task.schedule);
});

test('the editor saves approval choice and requests a new automatic title only when prompt changes', () => {
  const task = { ...tasks[0], approvalMode: 'review' };
  const form = createScheduledTaskForm(task);
  assert.equal(form.approvalMode, 'review');
  form.approvalMode = 'full_access';
  assert.equal(scheduledTaskFormPayload(form, task).approvalMode, 'full_access');
  assert.equal(scheduledTaskFormPayload(form, task).name, task.name);
  form.prompt = 'New request';
  assert.equal(Object.hasOwn(scheduledTaskFormPayload(form, task), 'name'), false);
  assert.equal(Object.hasOwn(scheduledTaskFormPayload(createScheduledTaskForm(null)), 'name'), false);
});

test('editing a one-time task without touching its clock preserves the absolute instant', () => {
  const form = createScheduledTaskForm(tasks[3]);
  form.name = 'Rename only';
  assert.equal(scheduledTaskFormPayload(form, tasks[3]).schedule.at, tasks[3].schedule.at);
  assert.equal(scheduledTaskNeedsReschedule(tasks[3], Date.parse('2026-11-01T00:00:00Z')), true);
  assert.equal(scheduledTaskNeedsReschedule({ ...tasks[3], enabled: true }), false);
});

test('weekly editor state and payload do not mutate the saved day selection', () => {
  const task = { ...tasks[0], schedule: { type: 'weekly', time: '09:00', timeZone: 'Asia/Shanghai', days: [1, 5] } };
  const form = createScheduledTaskForm(task);
  form.days.push(3);
  assert.deepEqual(scheduledTaskFormPayload(form, task).schedule.days, [1, 3, 5]);
  assert.deepEqual(task.schedule.days, [1, 5]);
});

test('schedule summaries include the interval or weekdays and card tones stay attached to IDs', () => {
  const t = key => key;
  assert.match(scheduledFrequencyLabel({ type: 'interval', minutes: 15 }, t, String), /15 scheduledMinuteUnit/);
  assert.match(scheduledFrequencyLabel({ type: 'weekly', time: '09:00', days: [1, 5] }, t, String), /09:00.*scheduledDay1.*scheduledDay5/);
  const before = tasks.map(task => [task.id, scheduledTaskTone(task.id)]);
  const after = new Map([...tasks].reverse().map(task => [task.id, scheduledTaskTone(task.id)]));
  for (const [id, tone] of before) assert.equal(after.get(id), tone);
});

test('task detail history requests use the scoped API without changing the library request', async t => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  const urls = [];
  globalThis.fetch = async url => { urls.push(url); return Response.json({ tasks: [], runs: [], worker: {} }); };
  await fetchScheduledTasks();
  await fetchScheduledTasks('task/a b');
  assert.deepEqual(urls, ['/api/scheduled-tasks', '/api/scheduled-tasks?taskId=task%2Fa%20b']);
});
