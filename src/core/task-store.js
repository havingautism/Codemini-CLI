import fs from 'node:fs/promises';
import path from 'node:path';

function legacyTasksFilePath(cwd = process.cwd()) {
  return path.join(cwd, '.coder', 'tasks.json');
}

function tasksFilePath(cwd = process.cwd(), sessionId = '') {
  const sid = String(sessionId || '').trim();
  if (!sid) return legacyTasksFilePath(cwd);
  return path.join(cwd, '.coder', 'tasks', `${sid}.json`);
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function normalizeTasks(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((t) => ({
      id: String(t?.id || '').trim(),
      title: String(t?.title || '').trim(),
      status: String(t?.status || 'pending').trim() || 'pending',
      description: String(t?.description || '').trim(),
      createdAt: String(t?.createdAt || ''),
      updatedAt: String(t?.updatedAt || '')
    }))
    .filter((t) => t.id && t.title);
}

function createTaskId() {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 7);
  return `task-${ts}-${rnd}`;
}

export async function loadTasks(cwd = process.cwd(), sessionId = '') {
  const filePath = tasksFilePath(cwd, sessionId);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeTasks(parsed?.tasks);
  } catch {
    if (sessionId) {
      try {
        const raw = await fs.readFile(legacyTasksFilePath(cwd), 'utf8');
        const parsed = JSON.parse(raw);
        return normalizeTasks(parsed?.tasks);
      } catch {
        return [];
      }
    }
    return [];
  }
}

export async function saveTasks(tasks, cwd = process.cwd(), sessionId = '') {
  const filePath = tasksFilePath(cwd, sessionId);
  await ensureDir(filePath);
  const normalized = normalizeTasks(tasks);
  await fs.writeFile(
    filePath,
    `${JSON.stringify({ updatedAt: new Date().toISOString(), tasks: normalized }, null, 2)}\n`,
    'utf8'
  );
  return normalized;
}

export async function createTasks(items, cwd = process.cwd(), sessionId = '') {
  const existing = await loadTasks(cwd, sessionId);
  const now = new Date().toISOString();
  const input = Array.isArray(items) ? items : [];
  const add = input
    .map((t) => ({
      id: createTaskId(),
      title: String(t?.title || '').trim(),
      description: String(t?.description || '').trim(),
      status: 'pending',
      createdAt: now,
      updatedAt: now
    }))
    .filter((t) => t.title);
  const next = [...existing, ...add];
  await saveTasks(next, cwd, sessionId);
  return add;
}

export async function updateTask(taskId, patch, cwd = process.cwd(), sessionId = '') {
  const tasks = await loadTasks(cwd, sessionId);
  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) return null;
  const next = [...tasks];
  const status = String(patch?.status || next[idx].status).trim();
  next[idx] = {
    ...next[idx],
    ...(patch?.title ? { title: String(patch.title) } : {}),
    ...(patch?.description !== undefined ? { description: String(patch.description || '') } : {}),
    status: ['pending', 'in_progress', 'completed'].includes(status) ? status : next[idx].status,
    updatedAt: new Date().toISOString()
  };
  await saveTasks(next, cwd, sessionId);
  return next[idx];
}

export async function deleteTasks(ids, cwd = process.cwd(), sessionId = '') {
  const remove = new Set((Array.isArray(ids) ? ids : []).map((v) => String(v)));
  const before = await loadTasks(cwd, sessionId);
  const kept = before.filter((t) => !remove.has(t.id));
  await saveTasks(kept, cwd, sessionId);
  return { removed: before.length - kept.length, remaining: kept.length };
}

export async function clearTasks(cwd = process.cwd(), sessionId = '') {
  await saveTasks([], cwd, sessionId);
}
