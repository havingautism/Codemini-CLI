import fs from 'node:fs/promises';
import path from 'node:path';

import { getProjectTowerWorktreesDir } from './paths.js';
import { runGit } from './process-run.js';
import {
  appendTowerWorkerRecord,
  listTowerWorkersFromState,
  readTowerStateFile,
  writeTowerWorkerRecords,
} from './tower-store.js';
import { findOverlappingTowerWorker, normalizeTowerDependsOn, normalizeTowerPaths } from './tower-scope.js';

const BRANCH_PREFIX = 'codemini-tower/';
const RESERVED_WORKER_IDS = new Set(['tmp', '_merge-tmp', 'merge-tmp']);
const GIT_TIMEOUT_MS = 30_000;
const spawnLocks = new Map();

async function tryGit(cwd, args) {
  return runGit(args, { cwd, allowFailure: true, timeoutMs: GIT_TIMEOUT_MS });
}

function withSpawnLock(cwd, fn) {
  const key = path.resolve(cwd);
  const previous = spawnLocks.get(key) || Promise.resolve();
  let release;
  const next = new Promise((resolve) => {
    release = resolve;
  });
  spawnLocks.set(key, previous.catch(() => {}).then(() => next));
  return previous.catch(() => {}).then(async () => {
    try {
      return await fn();
    } finally {
      release();
    }
  });
}

export function sanitizeTowerWorkerId(value, fallback = 'worker') {
  const cleaned = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return cleaned || fallback;
}

export function allocateTowerWorkerId({
  taskId = '',
  name = '',
  callId = '',
  existingIds = [],
} = {}) {
  const used = new Set([
    ...RESERVED_WORKER_IDS,
    ...(Array.isArray(existingIds) ? existingIds : [])
      .map((id) => String(id || '').toLowerCase())
      .filter(Boolean),
  ]);
  const preferred =
    sanitizeTowerWorkerId(taskId, '')
    || sanitizeTowerWorkerId(name, '')
    || sanitizeTowerWorkerId(callId, 'worker');
  if (preferred && !used.has(preferred)) return preferred;
  for (let index = 2; index < 1000; index += 1) {
    const next = `${preferred}-${index}`.slice(0, 48);
    if (!used.has(next)) return next;
  }
  return `${preferred}-${Date.now().toString(36)}`.slice(0, 48);
}

export function towerWorkerBranchName(workerId) {
  return `${BRANCH_PREFIX}${sanitizeTowerWorkerId(workerId)}`;
}

function posixPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function pathIsWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function isTowerWorktreePath(root) {
  return posixPath(root).includes('/.codemini/tower/worktrees/');
}

export function resolveTowerParentRoot(worktreePath) {
  const resolved = path.resolve(String(worktreePath || '').trim() || '.');
  const normalized = posixPath(resolved);
  const marker = '/.codemini/tower/worktrees/';
  const index = normalized.toLowerCase().lastIndexOf(marker);
  if (index <= 0) return '';
  return path.resolve(normalized.slice(0, index));
}

export function remapTowerParentPath(inputPath, worktreeRoot) {
  const raw = String(inputPath || '').trim();
  const worktree = path.resolve(String(worktreeRoot || '').trim() || '.');
  const parent = resolveTowerParentRoot(worktree);
  if (!raw || !parent) return raw;
  const absolute = path.resolve(worktree, raw);
  if (pathIsWithinRoot(worktree, absolute)) return raw;
  if (!pathIsWithinRoot(parent, absolute)) return raw;
  const relative = path.relative(parent, absolute);
  const relPosix = posixPath(relative);
  if (relPosix === '.codemini/tower' || relPosix.startsWith('.codemini/tower/')) return raw;
  return path.join(worktree, relative);
}

const TOWER_PATH_KEYS = ['path', 'file', 'file_path', 'target', 'notebook_path'];

export function remapTowerToolArguments(args, worktreeRoot) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
  const parent = resolveTowerParentRoot(worktreeRoot);
  if (!parent) return args;
  const next = { ...args };
  let changed = false;
  for (const key of TOWER_PATH_KEYS) {
    if (typeof next[key] !== 'string' || !next[key].trim()) continue;
    const remapped = remapTowerParentPath(next[key], worktreeRoot);
    if (remapped !== next[key]) {
      next[key] = remapped;
      changed = true;
    }
  }
  if (next.ast_target && typeof next.ast_target === 'object' && !Array.isArray(next.ast_target)) {
    const nestedPath = next.ast_target.path;
    if (typeof nestedPath === 'string' && nestedPath.trim()) {
      const remapped = remapTowerParentPath(nestedPath, worktreeRoot);
      if (remapped !== nestedPath) {
        next.ast_target = { ...next.ast_target, path: remapped };
        changed = true;
      }
    }
  }
  if (typeof next.patch_text === 'string' && parent && next.patch_text.includes(parent)) {
    next.patch_text = next.patch_text.split(parent).join(path.resolve(worktreeRoot));
    changed = true;
  }
  if (changed && typeof next.path === 'string' && next.path && !next.file_path) {
    next.file_path = next.path;
  }
  return changed ? next : args;
}

export async function isTowerWorktreeDirty(worktreePath) {
  const cwd = path.resolve(worktreePath);
  const status = await tryGit(cwd, ['status', '--porcelain']);
  return Boolean(String(status.stdout || '').trim());
}

async function worktreePathExists(worktreePath) {
  try {
    const stat = await fs.stat(worktreePath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export function withTowerGitLock(cwd, fn) {
  return withSpawnLock(cwd, fn);
}

export async function addTowerWorktree(options = {}) {
  return withSpawnLock(options.cwd || process.cwd(), () => addTowerWorktreeUnlocked(options));
}

async function addTowerWorktreeUnlocked({
  cwd = process.cwd(),
  base,
  taskId = '',
  name = '',
  callId = '',
  paths = [],
  dependsOn = [],
} = {}) {
  const root = path.resolve(cwd);
  const baseBranch = String(base || '').trim();
  if (!baseBranch || baseBranch === 'HEAD') {
    return { ok: false, code: 'NO_BASE', error: 'Tower spawn needs a recorded git base branch.' };
  }
  const normalizedPaths = normalizeTowerPaths(paths);
  if (normalizedPaths.length === 0) {
    return {
      ok: false,
      code: 'PATHS_REQUIRED',
      error: 'Tower run_subagent requires paths: an array of relative globs such as docs/** or src/foo.ts.',
    };
  }
  const current = await readTowerStateFile(root);
  const existing = listTowerWorkersFromState(current);
  const overlap = findOverlappingTowerWorker(normalizedPaths, existing);
  if (overlap) {
    const workerId = String(overlap.worker?.id || 'worker').trim() || 'worker';
    return {
      ok: false,
      code: 'SCOPE_OVERLAP',
      error: `Tower scope overlaps worker "${workerId}" (${overlap.existing} vs ${overlap.glob}). Change paths and retry.`,
      workerId,
      glob: overlap.glob,
      existing: overlap.existing,
    };
  }
  const workerId = allocateTowerWorkerId({
    taskId,
    name,
    callId,
    existingIds: existing.map((item) => item.id),
  });
  const branch = towerWorkerBranchName(workerId);
  const worktreePath = path.resolve(getProjectTowerWorktreesDir(root), workerId);
  await fs.mkdir(path.dirname(worktreePath), { recursive: true });
  if (await worktreePathExists(worktreePath)) {
    return {
      ok: false,
      code: 'WORKTREE_EXISTS',
      error: `Tower worktree already exists: ${worktreePath}`,
    };
  }
  const added = await tryGit(root, ['worktree', 'add', '-b', branch, worktreePath, baseBranch]);
  if (added.code !== 0) {
    await fs.rm(worktreePath, { recursive: true, force: true }).catch(() => {});
    return {
      ok: false,
      code: 'WORKTREE_ADD_FAILED',
      error: String(added.stderr || added.stdout || '').trim() || `Failed to add worktree for ${workerId}.`,
    };
  }
  const normalizedDependsOn = normalizeTowerDependsOn(dependsOn);
  const normalizedTaskId = String(taskId || '').trim();
  const worker = {
    id: workerId,
    branch,
    worktreePath,
    paths: normalizedPaths,
    ...(normalizedTaskId ? { taskId: normalizedTaskId } : {}),
    ...(normalizedDependsOn.length ? { dependsOn: normalizedDependsOn } : {}),
    ...(String(callId || '').trim() ? { callId: String(callId).trim() } : {}),
  };
  const saved = await appendTowerWorkerRecord(root, worker);
  if (!saved.ok) {
    await tryGit(root, ['worktree', 'remove', '--force', worktreePath]);
    return saved;
  }
  return { ok: true, worker: saved.worker || worker };
}

export async function removeTowerWorktree({
  cwd = process.cwd(),
  worker,
  force = false,
} = {}) {
  const root = path.resolve(cwd);
  const worktreePath = path.resolve(String(worker?.worktreePath || ''));
  if (!worktreePath) return { ok: false, skipped: true, reason: 'missing-path' };
  const exists = await worktreePathExists(worktreePath);
  if (!exists) {
    await tryGit(root, ['worktree', 'prune']);
    return { ok: true, removed: false, missing: true };
  }
  if (!force && await isTowerWorktreeDirty(worktreePath)) {
    return { ok: false, skipped: true, dirty: true, worker };
  }
  const removed = await tryGit(root, [
    'worktree',
    'remove',
    ...(force ? ['--force'] : []),
    worktreePath,
  ]);
  if (removed.code !== 0) {
    const dirty = await isTowerWorktreeDirty(worktreePath);
    if (dirty && !force) return { ok: false, skipped: true, dirty: true, worker };
    return {
      ok: false,
      error: String(removed.stderr || removed.stdout || '').trim() || 'Failed to remove worktree.',
      worker,
    };
  }
  return { ok: true, removed: true, worker };
}

export async function removeTowerWorktrees({ cwd = process.cwd(), force = false, skipLock = false } = {}) {
  const run = async () => {
    const root = path.resolve(cwd);
    const current = await readTowerStateFile(root);
    const workers = listTowerWorkersFromState(current);
    const kept = [];
    const removed = [];
    for (const worker of workers) {
      const result = await removeTowerWorktree({ cwd: root, worker, force });
      if (result.ok && (result.removed || result.missing)) removed.push(worker);
      else kept.push(worker);
    }
    await writeTowerWorkerRecords(root, kept);
    return { ok: true, removed, kept };
  };
  return skipLock ? run() : withSpawnLock(cwd, run);
}
