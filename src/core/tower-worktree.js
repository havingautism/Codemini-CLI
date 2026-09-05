import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getProjectTowerWorktreesDir } from './paths.js';
import { runGit } from './process-run.js';
import {
  appendTowerWorkerRecord,
  listTowerWorkersFromState,
  patchTowerWorkerRecord,
  readTowerStateFile,
  writeTowerWorkerRecords,
} from './tower-store.js';
import { findOverlappingTowerWorker, isTowerSurveyWorker, normalizeTowerDependsOn, normalizeTowerPaths, towerWorkerBlocksSpawn } from './tower-scope.js';

const BRANCH_PREFIX = 'codemini-tower/';
const RESERVED_WORKER_IDS = new Set(['tmp', '_merge-tmp', 'merge-tmp']);
const GIT_TIMEOUT_MS = 30_000;
const TOWER_WORKER_SEAL_MAX_NUDGES = 2;
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

export function findTowerWorker(workers, { resume = '', name = '', taskId = '', callId = '' } = {}) {
  const list = Array.isArray(workers) ? workers : [];
  const resumeId = sanitizeTowerWorkerId(resume, '');
  if (resumeId) {
    const byId = list.find((item) => item.id === resumeId);
    if (byId) return byId;
    const byCall = list.filter((item) => {
      const cid = sanitizeTowerWorkerId(item.callId, '');
      return cid && cid === resumeId;
    });
    if (byCall.length === 1) return byCall[0];
    return null;
  }
  const nameId = sanitizeTowerWorkerId(taskId, '')
    || sanitizeTowerWorkerId(name, '')
    || sanitizeTowerWorkerId(callId, '');
  if (!nameId) return null;
  return list.find((item) => item.id === nameId) || null;
}

export function formatIdleTowerWorkers(workers) {
  const list = (Array.isArray(workers) ? workers : []).filter((item) => item?.integrated !== true);
  if (list.length === 0) return 'No idle Crew workers. Spawn a new one with a unique name and paths.';
  const ids = list.map((item) => `"${item.id}"`).join(', ');
  return `Idle workers: ${ids}. Call back with resume set to that id (the short name, not a call/handoff id). Omit paths to keep the stored scope, or pass new disjoint paths.`;
}

export function composeTowerResumeTask(task, handoffText, reviewText = '', rebaseOnto = '') {
  const next = String(task || '').trim();
  const prior = String(handoffText || '').trim();
  const review = String(reviewText || '').trim();
  const onto = String(rebaseOnto || '').trim();
  if (!prior && !review && !onto) return next;
  return [
    next,
    prior ? 'Previous shift handoff (context from last run, not a new requirement):' : '',
    prior,
    review ? 'Latest review (fix these findings, then git commit again):' : '',
    review,
    onto
      ? `Rebase onto ${onto} in this worktree (git rebase ${onto}), resolve any conflicts, then git commit. Stay in your paths. Do not merge into the user branch.`
      : '',
  ].filter(Boolean).join('\n\n');
}

export function composeTowerReviewTask(task, {
  workerId = '',
  commit = '',
  paths = [],
  diff = '',
  base = '',
} = {}) {
  const scope = Array.isArray(paths) && paths.length ? paths.join(', ') : 'none';
  return [
    String(task || '').trim() || `Review worker "${workerId}".`,
    `You are reviewing Crew worker "${workerId}" at commit ${commit} against base ${base}.`,
    `Scope: ${scope}. Stay inside that scope.`,
    'Do not edit files or git commit. Finish by calling submit_tower_review with passed true or false and findings. passed true requires empty findings; passed false requires at least one finding.',
    diff ? `Diff vs base:\n${diff}` : 'No diff vs base was available; inspect the worktree.',
  ].join('\n\n');
}

export async function resolveTowerReviewTarget({
  cwd = process.cwd(),
  base = '',
  review = '',
  resume = '',
} = {}) {
  const root = path.resolve(cwd);
  if (String(resume || '').trim()) {
    return {
      ok: false,
      code: 'REVIEW_RESUME_CONFLICT',
      error: 'review cannot be combined with resume. Set review to the worker id, such as alisa.',
    };
  }
  const workerId = sanitizeTowerWorkerId(review, '');
  if (!workerId) {
    return {
      ok: false,
      code: 'REVIEW_TARGET_REQUIRED',
      error: 'review requires a roster worker id, such as alisa.',
    };
  }
  const existing = listTowerWorkersFromState(await readTowerStateFile(root));
  const worker = findTowerWorker(existing, { resume: workerId });
  if (!worker) {
    return {
      ok: false,
      code: 'REVIEW_UNKNOWN',
      error: `Unknown review target "${workerId}". ${formatIdleTowerWorkers(existing)}`,
    };
  }
  if (!(await worktreePathExists(worker.worktreePath))) {
    return {
      ok: false,
      code: 'WORKTREE_MISSING',
      error: `Crew worker "${worker.id}" is on the roster but its worktree is gone. Spawn it again with paths.`,
      workerId: worker.id,
    };
  }
  if (isTowerSurveyWorker(worker)) {
    return {
      ok: false,
      code: 'SURVEY_NO_REVIEW',
      error: `Worker "${worker.id}" is a survey worker. Do not review or land it.`,
      workerId: worker.id,
    };
  }
  if (worker.integrated === true) {
    return {
      ok: false,
      code: 'WORKER_INTEGRATED',
      error: `Worker "${worker.id}" is already integrated onto the base branch. Do not review it again. Wait for the rest of the roster, then land_workers.`,
      workerId: worker.id,
    };
  }
  if (await isTowerWorktreeDirty(worker.worktreePath)) {
    return {
      ok: false,
      code: 'DIRTY_WORKTREE',
      error: `Worker "${worker.id}" is not sealed. Wait until it git commits before review.`,
      workerId: worker.id,
    };
  }
  const tip = await tryGit(worker.worktreePath, ['rev-parse', 'HEAD']);
  const commit = String(tip.stdout || '').trim();
  if (tip.code !== 0 || !commit) {
    return {
      ok: false,
      code: 'REVIEW_COMMIT_MISSING',
      error: `Could not read HEAD for worker "${worker.id}".`,
      workerId: worker.id,
    };
  }
  const baseRef = String(worker.landBase || '').trim() || String(base || '').trim();
  const diff = baseRef
    ? await tryGit(worker.worktreePath, ['diff', `${baseRef}...HEAD`])
    : { stdout: '' };
  return {
    ok: true,
    review: true,
    worker,
    commit,
    base: baseRef,
    diff: String(diff.stdout || '').trim(),
  };
}

export async function isTowerCommitAncestor(cwd, ancestor, tip = 'HEAD') {
  const sha = String(ancestor || '').trim();
  const target = String(tip || 'HEAD').trim() || 'HEAD';
  if (!sha || !cwd) return false;
  const result = await tryGit(cwd, ['merge-base', '--is-ancestor', sha, target]);
  return result.code === 0;
}

export async function towerWorktreeExists(worktreePath) {
  return worktreePathExists(worktreePath);
}

function preferredTowerWorkerId({ taskId = '', name = '', callId = '' } = {}) {
  return sanitizeTowerWorkerId(taskId, '')
    || sanitizeTowerWorkerId(name, '')
    || sanitizeTowerWorkerId(callId, 'worker');
}

function towerPathsEqual(left, right) {
  const a = normalizeTowerPaths(left);
  const b = normalizeTowerPaths(right);
  if (a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}

export async function resolveTowerSubagentWorkspace({
  cwd = process.cwd(),
  base,
  resume = '',
  taskId = '',
  name = '',
  callId = '',
  paths = [],
  dependsOn = [],
  kind = '',
} = {}) {
  const root = path.resolve(cwd);
  const resumeId = sanitizeTowerWorkerId(resume, '');
  const existing = listTowerWorkersFromState(await readTowerStateFile(root));

  if (resumeId) {
    const worker = findTowerWorker(existing, { resume });
    if (worker) {
      if (worker.integrated === true && !String(worker.rebaseOnto || '').trim()) {
        return {
          ok: false,
          code: 'WORKER_INTEGRATED',
          error: `Crew worker "${worker.id}" is already integrated onto the base branch. Wait for the rest of the roster, then land_workers. Do not resume.`,
          workerId: worker.id,
        };
      }
      if (!(await worktreePathExists(worker.worktreePath))) {
        return {
          ok: false,
          code: 'WORKTREE_MISSING',
          error: `Crew worker "${worker.id}" is on the roster but its worktree is gone. Spawn it again with paths.`,
          workerId: worker.id,
        };
      }
      const requested = normalizeTowerPaths(paths);
      if (requested.length > 0 && !towerPathsEqual(requested, worker.paths)) {
        const overlap = findOverlappingTowerWorker(requested, existing, { exceptId: worker.id });
        if (overlap) {
          const otherId = String(overlap.worker?.id || 'worker').trim() || 'worker';
          return {
            ok: false,
            code: 'SCOPE_OVERLAP',
            error: `Tower resume "${worker.id}" paths overlap worker "${otherId}" (${overlap.existing} vs ${overlap.glob}). Change paths and retry.`,
            workerId: worker.id,
          };
        }
        const patched = await patchTowerWorkerRecord(root, worker.id, {
          paths: requested,
          reviewLoopStopped: false,
          reviewRound: 0,
          lastFindingsKey: '',
        });
        if (!patched.ok) {
          return {
            ok: false,
            code: 'PATHS_PATCH_FAILED',
            error: patched.error || `Failed to update paths for "${worker.id}".`,
            workerId: worker.id,
          };
        }
        return {
          ok: true,
          resume: true,
          worker: patched.worker || { ...worker, paths: requested },
          pathsChanged: true,
        };
      }
      return { ok: true, resume: true, worker };
    }
    const named = findTowerWorker(existing, { name, taskId });
    if (named) {
      return {
        ok: false,
        code: 'RESUME_UNKNOWN',
        error: `Unknown resume "${resumeId}". Worker "${named.id}" is idle. Call run_subagent with resume: "${named.id}" and omit paths.`,
        workerId: named.id,
      };
    }
    if (existing.length > 0) {
      return {
        ok: false,
        code: 'RESUME_UNKNOWN',
        error: `Unknown resume "${resumeId}". ${formatIdleTowerWorkers(existing)}`,
      };
    }
    return addTowerWorktree({
      cwd: root,
      base,
      taskId: resumeId,
      name: resumeId,
      callId,
      paths,
      dependsOn,
      kind,
    });
  }

  const named = findTowerWorker(existing, { name, taskId });
  if (named && towerWorkerBlocksSpawn(named)) {
    return {
      ok: false,
      code: 'WORKER_EXISTS',
      error: `Crew worker "${named.id}" already exists. Call run_subagent with resume: "${named.id}".`,
      workerId: named.id,
    };
  }

  return addTowerWorktree({
    cwd: root,
    base,
    taskId,
    name,
    callId,
    paths,
    dependsOn,
    kind,
  });
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

function towerWorkerIdFromWorktreePath(worktreePath) {
  const worktree = path.resolve(String(worktreePath || '').trim() || '.');
  const parent = resolveTowerParentRoot(worktree);
  if (!parent) return '';
  const rel = posixPath(path.relative(path.join(parent, '.codemini', 'tower', 'worktrees'), worktree));
  if (!rel || rel === '.' || rel.startsWith('..') || rel.includes('/') || path.isAbsolute(rel)) return '';
  if (RESERVED_WORKER_IDS.has(rel)) return '';
  const id = sanitizeTowerWorkerId(rel, '');
  if (!id || id !== rel) return '';
  return id;
}

function readTowerWorktreeGitDir(worktree, parent) {
  try {
    const gitFile = path.join(worktree, '.git');
    if (!fsSync.statSync(gitFile).isFile()) return '';
    const line = fsSync.readFileSync(gitFile, 'utf8')
      .split(/\r?\n/)
      .find((entry) => entry.toLowerCase().startsWith('gitdir:'));
    if (!line) return '';
    const gitDir = path.resolve(worktree, line.slice('gitdir:'.length).trim());
    const allowed = path.join(parent, '.git', 'worktrees');
    const rel = posixPath(path.relative(allowed, gitDir));
    if (!rel || rel === '.' || rel.startsWith('..') || rel.includes('/') || path.isAbsolute(rel)) return '';
    return gitDir;
  } catch {
    return '';
  }
}

/**
 * Narrow parent-repo git dirs a tower worker needs in order to `git commit`
 * through the shared `.git`. Never includes the parent checkout, hooks, or
 * config — only objects, this worktree's git dir, and the tower ref namespace.
 */
export function towerGitWritableRoots(workspaceRoot) {
  const worktree = path.resolve(String(workspaceRoot || '').trim() || '.');
  const parent = resolveTowerParentRoot(worktree);
  const workerId = towerWorkerIdFromWorktreePath(worktree);
  if (!parent || !workerId) return [];
  const gitDir = path.join(parent, '.git');
  const worktreeGitDir = readTowerWorktreeGitDir(worktree, parent)
    || path.join(gitDir, 'worktrees', workerId);
  return [
    path.join(gitDir, 'objects'),
    worktreeGitDir,
    path.join(gitDir, 'refs', 'heads', 'codemini-tower'),
    path.join(gitDir, 'logs', 'refs', 'heads', 'codemini-tower'),
  ];
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

export function towerWorkerClaimedBlocked(text) {
  return /\b(blocked|failed|cannot finish|can't finish|can’t finish)\b/i.test(String(text || ''));
}

export function composeTowerWorkerSealNudge(kind = 'coder') {
  if (kind === 'survey') {
    return 'Survey workers must not change files. Revert any edits in this worktree and stop. Do not git commit product code.';
  }
  return 'Worktree is still dirty (not sealed). If the slice is done, git add the files in your paths and git commit on this branch now. If you cannot finish, do not commit; reply with blocked or failed and stop.';
}

export function decideTowerWorkerSeal({
  dirty = false,
  kind = 'coder',
  text = '',
  nudgeCount = 0,
} = {}) {
  if (nudgeCount >= TOWER_WORKER_SEAL_MAX_NUDGES) return { continue: false };
  if (!dirty) return { continue: false };
  if (kind === 'survey') {
    return { continue: true, content: composeTowerWorkerSealNudge('survey') };
  }
  if (towerWorkerClaimedBlocked(text)) return { continue: false };
  return { continue: true, content: composeTowerWorkerSealNudge('coder') };
}

export async function shouldContinueTowerWorkerSeal({
  worktreePath,
  kind = 'coder',
  text = '',
  nudgeCount = 0,
} = {}) {
  const dirty = await isTowerWorktreeDirty(worktreePath).catch(() => true);
  return decideTowerWorkerSeal({ dirty, kind, text, nudgeCount });
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
  kind = '',
} = {}) {
  const root = path.resolve(cwd);
  const baseBranch = String(base || '').trim();
  if (!baseBranch || baseBranch === 'HEAD') {
    return { ok: false, code: 'NO_BASE', error: 'Tower spawn needs a recorded git base branch.' };
  }
  const survey = String(kind || '').trim().toLowerCase() === 'survey';
  const normalizedPaths = normalizeTowerPaths(paths);
  if (!survey && normalizedPaths.length === 0) {
    return {
      ok: false,
      code: 'PATHS_REQUIRED',
      error: 'Tower run_subagent requires paths: an array of relative globs such as docs/** or src/foo.ts.',
    };
  }
  const current = await readTowerStateFile(root);
  const existing = listTowerWorkersFromState(current);
  if (!survey) {
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
  }
  const preferred = preferredTowerWorkerId({ taskId, name, callId });
  if (
    preferred
    && !RESERVED_WORKER_IDS.has(preferred)
    && existing.some((item) => item.id === preferred && towerWorkerBlocksSpawn(item))
  ) {
    return {
      ok: false,
      code: 'WORKER_EXISTS',
      error: `Crew worker "${preferred}" already exists. Call run_subagent with resume: "${preferred}".`,
      workerId: preferred,
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
    ...(normalizedPaths.length ? { paths: normalizedPaths } : {}),
    ...(survey ? { kind: 'survey' } : {}),
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

export async function teardownTowerWorker({
  cwd = process.cwd(),
  id = '',
  force = true,
} = {}) {
  const workerId = String(id || '').trim();
  if (!workerId) return { ok: false, error: 'Missing Crew worker id.' };
  return withSpawnLock(cwd, async () => {
    const root = path.resolve(cwd);
    const workers = listTowerWorkersFromState(await readTowerStateFile(root));
    const worker = workers.find((item) => item.id === workerId);
    if (!worker) return { ok: false, code: 'NOT_FOUND', error: `Unknown Crew worker "${workerId}".` };
    const worktree = await removeTowerWorktree({ cwd: root, worker, force });
    const branch = String(worker.branch || '').trim();
    if (branch.startsWith(BRANCH_PREFIX) && !RESERVED_WORKER_IDS.has(worker.id)) {
      await tryGit(root, ['branch', '-D', branch]);
    }
    await writeTowerWorkerRecords(root, workers.filter((item) => item.id !== workerId));
    await tryGit(root, ['worktree', 'prune']);
    return {
      ok: true,
      worker,
      worktreeRemoved: worktree.removed === true || worktree.missing === true,
    };
  });
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
