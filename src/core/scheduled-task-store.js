import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getGlobalDatabase, transaction } from './sqlite-database.js';
import { normalizeTaskSchedule, nextTaskTime } from './task-schedule.js';

const iso = now => new Date(now).toISOString();
const active = "status IN ('queued', 'running')";
const taskFromRow = row => row ? ({ id: row.id, name: row.name, prompt: row.prompt, projectDir: row.project_dir,
  mode: row.mode, approvalMode: row.approval_mode || '', schedule: JSON.parse(row.schedule_json), enabled: Boolean(row.enabled), nextRunAt: row.next_run_at,
  createdAt: row.created_at, updatedAt: row.updated_at }) : null;
const runFromRow = row => row ? ({ id: row.id, taskId: row.task_id, scheduledFor: row.scheduled_for,
  trigger: row.trigger_kind, status: row.status, sessionId: row.session_id, createdAt: row.created_at,
  startedAt: row.started_at, finishedAt: row.finished_at, error: row.error, task: JSON.parse(row.snapshot_json) }) : null;

export function getScheduledChangeState(now = Date.now()) {
  const row = getGlobalDatabase().prepare(`SELECT c.revision, c.session_revision,
    COALESCE(w.lease_until > ?, 0) AS worker_running
    FROM scheduled_changes c LEFT JOIN scheduled_worker w ON w.id=1 WHERE c.id=1`).get(iso(now));
  return { revision: row.revision, sessionRevision: row.session_revision, workerRunning: Boolean(row.worker_running) };
}

export function getScheduledTask(id) {
  return taskFromRow(getGlobalDatabase().prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id));
}
export function getScheduledSessionInfo(sessionId) {
  if (!sessionId) return null;
  const row = getGlobalDatabase().prepare('SELECT * FROM scheduled_task_runs WHERE session_id=? ORDER BY created_at DESC LIMIT 1').get(sessionId);
  return row ? runFromRow(row) : null;
}
export function markScheduledSessionContinued(sessionId) {
  getGlobalDatabase().prepare("UPDATE scheduled_task_runs SET status='continued' WHERE session_id=? AND status='needs_attention'").run(sessionId);
}
export function listScheduledTasks() {
  return getGlobalDatabase().prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC, id').all().map(taskFromRow);
}
export function listScheduledRuns(taskId = '') {
  return getGlobalDatabase().prepare(`SELECT * FROM scheduled_task_runs ${taskId ? 'WHERE task_id = ?' : ''} ORDER BY created_at DESC, id DESC LIMIT 100`)
    .all(...(taskId ? [taskId] : [])).map(runFromRow);
}
export function saveScheduledTask(input, id = '', now = Date.now()) {
  const db = getGlobalDatabase();
  return transaction(db, () => {
    const previous = id ? getScheduledTask(id) : null;
    if (id && !previous) throw new Error('Scheduled task not found.');
    const merged = { ...previous, ...input };
    const name = String(merged.name || '').trim();
    const prompt = String(merged.prompt || '').trim();
    if (!name || name.length > 120 || !prompt || prompt.length > 50000) throw new Error('A name (1–120 characters) and prompt (1–50000 characters) are required.');
    if (!['normal', 'plan'].includes(merged.mode)) throw new Error('Choose daily or coding mode.');
    const approvalMode = merged.approvalMode ?? 'auto';
    if (!['review', 'auto', 'full_access'].includes(approvalMode) && !(previous && approvalMode === '')) throw new Error('Invalid approval mode.');
    if (typeof merged.projectDir !== 'string' || !path.isAbsolute(merged.projectDir)) throw new Error('Project directory must be an absolute path.');
    if (merged.enabled !== undefined && typeof merged.enabled !== 'boolean') throw new Error('Enabled must be a boolean.');
    const schedule = normalizeTaskSchedule(merged.schedule);
    const enabled = merged.enabled !== false;
    const changed = !previous || JSON.stringify(previous.schedule) !== JSON.stringify(schedule) || previous.enabled !== enabled;
    if (enabled && changed && schedule.type === 'once' && Date.parse(schedule.at) <= now) throw new Error('Choose a future time for this one-time task.');
    const nextRunAt = enabled ? (changed ? nextTaskTime(schedule, now) : previous.nextRunAt) : null;
    const taskId = id || randomUUID();
    db.prepare(`INSERT INTO scheduled_tasks (id, name, prompt, project_dir, mode, schedule_json, enabled, next_run_at, created_at, updated_at, approval_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, prompt=excluded.prompt, project_dir=excluded.project_dir,
      mode=excluded.mode, approval_mode=excluded.approval_mode, schedule_json=excluded.schedule_json, enabled=excluded.enabled, next_run_at=excluded.next_run_at, updated_at=excluded.updated_at`)
      .run(taskId, name, prompt, path.resolve(merged.projectDir), merged.mode, JSON.stringify(schedule), Number(enabled), nextRunAt, previous?.createdAt || iso(now), iso(now), approvalMode);
    return getScheduledTask(taskId);
  });
}
export function deleteScheduledTask(id) {
  const db = getGlobalDatabase();
  return transaction(db, () => {
    if (db.prepare(`SELECT 1 FROM scheduled_task_runs WHERE task_id=? AND ${active}`).get(id)) throw new Error('Pause and wait for the active run before deleting this task.');
    if (!db.prepare('DELETE FROM scheduled_tasks WHERE id=?').run(id).changes) throw new Error('Scheduled task not found.');
  });
}
export function queueScheduledTask(id, now = Date.now()) {
  const db = getGlobalDatabase();
  return transaction(db, () => {
    const task = getScheduledTask(id);
    if (!task) throw new Error('Scheduled task not found.');
    if (db.prepare(`SELECT 1 FROM scheduled_task_runs WHERE task_id=? AND ${active}`).get(id)) throw new Error('This task is already queued or running.');
    const runId = randomUUID();
    db.prepare(`INSERT INTO scheduled_task_runs(id, task_id, trigger_kind, status, snapshot_json, created_at) VALUES (?, ?, 'manual', 'queued', ?, ?)`)
      .run(runId, id, JSON.stringify(task), iso(now));
    return runFromRow(db.prepare('SELECT * FROM scheduled_task_runs WHERE id=?').get(runId));
  });
}
export function scheduledWorkerStatus(now = Date.now()) {
  const row = getGlobalDatabase().prepare('SELECT * FROM scheduled_worker WHERE id=1').get();
  return { running: Boolean(row && Date.parse(row.lease_until) > now), pid: row?.pid || null, heartbeatAt: row?.heartbeat_at || null };
}
export function acquireScheduledWorker(owner, pid, now = Date.now(), leaseMs = 90000) {
  return Boolean(getGlobalDatabase().prepare(`INSERT INTO scheduled_worker VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id, pid=excluded.pid, lease_until=excluded.lease_until, heartbeat_at=excluded.heartbeat_at
    WHERE scheduled_worker.lease_until <= ? OR scheduled_worker.owner_id=excluded.owner_id`)
    .run(owner, pid, iso(now + leaseMs), iso(now), iso(now)).changes);
}
export function releaseScheduledWorker(owner) {
  getGlobalDatabase().prepare('DELETE FROM scheduled_worker WHERE owner_id=?').run(owner);
}
export function releaseScheduledWorkerIfIdle(owner) {
  return transaction(getGlobalDatabase(), () => {
    if (hasScheduledWork()) return false;
    releaseScheduledWorker(owner);
    return true;
  });
}
export function recoverScheduledRuns(owner, now = Date.now()) {
  getGlobalDatabase().prepare(`UPDATE scheduled_task_runs SET status='interrupted', finished_at=?, error='Background worker stopped before completion. Open the session to inspect; this run will not be replayed automatically.' WHERE status='running' AND owner_id <> ?`)
    .run(iso(now), owner);
}
export function hasScheduledWork() {
  const db = getGlobalDatabase();
  return Boolean(db.prepare('SELECT 1 FROM scheduled_tasks WHERE enabled=1 LIMIT 1').get() || db.prepare(`SELECT 1 FROM scheduled_task_runs WHERE ${active} LIMIT 1`).get());
}
export function isScheduledSessionActive(sessionId) {
  return Boolean(sessionId && getGlobalDatabase().prepare("SELECT 1 FROM scheduled_task_runs WHERE session_id=? AND status='running'").get(sessionId));
}
export function claimScheduledRun(owner, now = Date.now()) {
  const db = getGlobalDatabase();
  return transaction(db, () => {
    if (!db.prepare('SELECT 1 FROM scheduled_worker WHERE owner_id=? AND lease_until>?').get(owner, iso(now))) return null;
    let row = db.prepare("SELECT * FROM scheduled_task_runs WHERE status='queued' ORDER BY created_at, id LIMIT 1").get();
    if (!row) {
      const due = db.prepare(`SELECT * FROM scheduled_tasks t WHERE enabled=1 AND next_run_at<=? AND NOT EXISTS
        (SELECT 1 FROM scheduled_task_runs r WHERE r.task_id=t.id AND r.${active}) ORDER BY next_run_at, id LIMIT 1`).get(iso(now));
      if (!due) return null;
      const task = taskFromRow(due);
      const next = task.schedule.type === 'once' ? null : nextTaskTime(task.schedule, now, task.nextRunAt);
      db.prepare('UPDATE scheduled_tasks SET next_run_at=?, enabled=?, updated_at=? WHERE id=?').run(next, Number(task.schedule.type !== 'once'), iso(now), task.id);
      const id = randomUUID();
      db.prepare(`INSERT INTO scheduled_task_runs(id, task_id, scheduled_for, trigger_kind, status, snapshot_json, created_at) VALUES (?, ?, ?, 'scheduled', 'queued', ?, ?)`)
        .run(id, task.id, task.nextRunAt, JSON.stringify(task), iso(now));
      row = db.prepare('SELECT * FROM scheduled_task_runs WHERE id=?').get(id);
    }
    db.prepare("UPDATE scheduled_task_runs SET status='running', started_at=?, owner_id=? WHERE id=?").run(iso(now), owner, row.id);
    return runFromRow(db.prepare('SELECT * FROM scheduled_task_runs WHERE id=?').get(row.id));
  });
}
export function bindScheduledSession(runId, sessionId) {
  getGlobalDatabase().prepare("UPDATE scheduled_task_runs SET session_id=? WHERE id=? AND status='running'").run(sessionId, runId);
}
export function finishScheduledRun(runId, status, error = '', now = Date.now()) {
  if (!['completed', 'failed', 'needs_attention', 'interrupted'].includes(status)) throw new Error('Invalid scheduled run status.');
  getGlobalDatabase().prepare("UPDATE scheduled_task_runs SET status=?, error=?, finished_at=? WHERE id=? AND status='running'")
    .run(status, String(error).slice(0, 4000), iso(now), runId);
}
