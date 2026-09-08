import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getProjectCrewWorktreesDir } from './paths.js';
import { runGit } from './process-run.js';
import {
  appendCrewWorkerRecord,
  listCrewWorkersFromState,
  patchCrewWorkerRecord,
  readCrewStateFile,
  writeCrewWorkerRecords,
} from './crew-store.js';
import { findOverlappingCrewWorker, isCrewSurveyWorker, normalizeCrewDependsOn, normalizeCrewPaths, crewWorkerBlocksSpawn } from './crew-scope.js';

const BRANCH_PREFIX = 'codemini-crew/';
const RESERVED_WORKER_IDS = new Set(['tmp', '_merge-tmp', 'merge-tmp']);
const GIT_TIMEOUT_MS = 30_000;
const CREW_WORKER_SEAL_MAX_NUDGES = 2;
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

export function sanitizeCrewWorkerId(value, fallback = 'worker') {
  const cleaned = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return cleaned || fallback;
}

export function allocateCrewWorkerId({
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
    sanitizeCrewWorkerId(taskId, '')
    || sanitizeCrewWorkerId(name, '')
    || sanitizeCrewWorkerId(callId, 'worker');
  if (preferred && !used.has(preferred)) return preferred;
  for (let index = 2; index < 1000; index += 1) {
    const next = `${preferred}-${index}`.slice(0, 48);
    if (!used.has(next)) return next;
  }
  return `${preferred}-${Date.now().toString(36)}`.slice(0, 48);
}

export function crewWorkerBranchName(workerId) {
  return `${BRANCH_PREFIX}${sanitizeCrewWorkerId(workerId)}`;
}

export function findCrewWorker(workers, { resume = '', name = '', taskId = '', callId = '' } = {}) {
  const list = Array.isArray(workers) ? workers : [];
  const resumeId = sanitizeCrewWorkerId(resume, '');
  if (resumeId) {
    const byId = list.find((item) => item.id === resumeId);
    if (byId) return byId;
    const byCall = list.filter((item) => {
      const cid = sanitizeCrewWorkerId(item.callId, '');
      return cid && cid === resumeId;
    });
    if (byCall.length === 1) return byCall[0];
    return null;
  }
  const nameId = sanitizeCrewWorkerId(taskId, '')
    || sanitizeCrewWorkerId(name, '')
    || sanitizeCrewWorkerId(callId, '');
  if (!nameId) return null;
  return list.find((item) => item.id === nameId) || null;
}

export function formatIdleCrewWorkers(workers) {
  const list = (Array.isArray(workers) ? workers : []).filter((item) => item?.integrated !== true);
  if (list.length === 0) return 'No idle Crew workers. Spawn a new one with a unique name and paths.';
  const ids = list.map((item) => `"${item.id}"`).join(', ');
  return `Idle workers: ${ids}. Call back with resume set to that id (the short name, not a call/handoff id). Omit paths to keep the stored scope, or pass new disjoint paths.`;
}

export function composeCrewResumeTask(task, handoffText, reviewText = '', rebaseOnto = '') {
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

export function composeCrewReviewTask(task, {
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
    'Do not edit files or git commit. Finish by calling submit_crew_review with passed true or false and findings. passed true requires empty findings; passed false requires at least one finding.',
    diff ? `Diff vs base:\n${diff}` : 'No diff vs base was available; inspect the worktree.',
  ].join('\n\n');
}

export async function resolveCrewReviewTarget({
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
  const workerId = sanitizeCrewWorkerId(review, '');
  if (!workerId) {
    return {
      ok: false,
      code: 'REVIEW_TARGET_REQUIRED',
      error: 'review requires a roster worker id, such as alisa.',
    };
  }
  const existing = listCrewWorkersFromState(await readCrewStateFile(root));
  const worker = findCrewWorker(existing, { resume: workerId });
  if (!worker) {
    return {
      ok: false,
      code: 'REVIEW_UNKNOWN',
      error: `Unknown review target "${workerId}". ${formatIdleCrewWorkers(existing)}`,
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
  if (isCrewSurveyWorker(worker)) {
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
  if (await isCrewWorktreeDirty(worker.worktreePath)) {
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

export async function isCrewCommitAncestor(cwd, ancestor, tip = 'HEAD') {
  const sha = String(ancestor || '').trim();
  const target = String(tip || 'HEAD').trim() || 'HEAD';
  if (!sha || !cwd) return false;
  const result = await tryGit(cwd, ['merge-base', '--is-ancestor', sha, target]);
  return result.code === 0;
}

export async function crewWorktreeExists(worktreePath) {
  return worktreePathExists(worktreePath);
}

function preferredCrewWorkerId({ taskId = '', name = '', callId = '' } = {}) {
  return sanitizeCrewWorkerId(taskId, '')
    || sanitizeCrewWorkerId(name, '')
    || sanitizeCrewWorkerId(callId, 'worker');
}

function crewPathsEqual(left, right) {
  const a = normalizeCrewPaths(left);
  const b = normalizeCrewPaths(right);
  if (a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}

export async function resolveCrewSubagentWorkspace({
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
  const resumeId = sanitizeCrewWorkerId(resume, '');
  const existing = listCrewWorkersFromState(await readCrewStateFile(root));

  if (resumeId) {
    const worker = findCrewWorker(existing, { resume });
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
      const requested = normalizeCrewPaths(paths);
      if (requested.length > 0 && !crewPathsEqual(requested, worker.paths)) {
        const overlap = findOverlappingCrewWorker(requested, existing, { exceptId: worker.id });
        if (overlap) {
          const otherId = String(overlap.worker?.id || 'worker').trim() || 'worker';
          return {
            ok: false,
            code: 'SCOPE_OVERLAP',
            error: `Crew resume "${worker.id}" paths overlap worker "${otherId}" (${overlap.existing} vs ${overlap.glob}). Change paths and retry.`,
            workerId: worker.id,
          };
        }
        const patched = await patchCrewWorkerRecord(root, worker.id, {
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
    const named = findCrewWorker(existing, { name, taskId });
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
        error: `Unknown resume "${resumeId}". ${formatIdleCrewWorkers(existing)}`,
      };
    }
    return addCrewWorktree({
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

  const named = findCrewWorker(existing, { name, taskId });
  if (named && crewWorkerBlocksSpawn(named)) {
    return {
      ok: false,
      code: 'WORKER_EXISTS',
      error: `Crew worker "${named.id}" already exists. Call run_subagent with resume: "${named.id}".`,
      workerId: named.id,
    };
  }

  return addCrewWorktree({
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

export function isCrewWorktreePath(root) {
  return posixPath(root).includes('/.codemini/crew/worktrees/');
}

export function resolveCrewParentRoot(worktreePath) {
  const resolved = path.resolve(String(worktreePath || '').trim() || '.');
  const normalized = posixPath(resolved);
  const marker = '/.codemini/crew/worktrees/';
  const index = normalized.toLowerCase().lastIndexOf(marker);
  if (index <= 0) return '';
  return path.resolve(normalized.slice(0, index));
}

function crewWorkerIdFromWorktreePath(worktreePath) {
  const worktree = path.resolve(String(worktreePath || '').trim() || '.');
  const parent = resolveCrewParentRoot(worktree);
  if (!parent) return '';
  const rel = posixPath(path.relative(path.join(parent, '.codemini', 'crew', 'worktrees'), worktree));
  if (!rel || rel === '.' || rel.startsWith('..') || rel.includes('/') || path.isAbsolute(rel)) return '';
  if (RESERVED_WORKER_IDS.has(rel)) return '';
  const id = sanitizeCrewWorkerId(rel, '');
  if (!id || id !== rel) return '';
  return id;
}

function readCrewWorktreeGitDir(worktree, parent) {
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
 * Narrow parent-repo git dirs a crew worker needs in order to `git commit`
 * through the shared `.git`. Never includes the parent checkout, hooks, or
 * config — only objects, this worktree's git dir, and the crew ref namespace.
 */
export function crewGitWritableRoots(workspaceRoot) {
  const worktree = path.resolve(String(workspaceRoot || '').trim() || '.');
  const parent = resolveCrewParentRoot(worktree);
  const workerId = crewWorkerIdFromWorktreePath(worktree);
  if (!parent || !workerId) return [];
  const gitDir = path.join(parent, '.git');
  const worktreeGitDir = readCrewWorktreeGitDir(worktree, parent)
    || path.join(gitDir, 'worktrees', workerId);
  return [
    path.join(gitDir, 'objects'),
    worktreeGitDir,
    path.join(gitDir, 'refs', 'heads', 'codemini-crew'),
    path.join(gitDir, 'logs', 'refs', 'heads', 'codemini-crew'),
  ];
}

export function remapCrewParentPath(inputPath, worktreeRoot) {
  const raw = String(inputPath || '').trim();
  const worktree = path.resolve(String(worktreeRoot || '').trim() || '.');
  const parent = resolveCrewParentRoot(worktree);
  if (!raw || !parent) return raw;
  const absolute = path.resolve(worktree, raw);
  if (pathIsWithinRoot(worktree, absolute)) return raw;
  if (!pathIsWithinRoot(parent, absolute)) return raw;
  const relative = path.relative(parent, absolute);
  const relPosix = posixPath(relative);
  if (relPosix === '.codemini/crew' || relPosix.startsWith('.codemini/crew/')) return raw;
  return path.join(worktree, relative);
}

const CREW_PATH_KEYS = ['path', 'file', 'file_path', 'target', 'notebook_path'];

export function remapCrewToolArguments(args, worktreeRoot) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
  const parent = resolveCrewParentRoot(worktreeRoot);
  if (!parent) return args;
  const next = { ...args };
  let changed = false;
  for (const key of CREW_PATH_KEYS) {
    if (typeof next[key] !== 'string' || !next[key].trim()) continue;
    const remapped = remapCrewParentPath(next[key], worktreeRoot);
    if (remapped !== next[key]) {
      next[key] = remapped;
      changed = true;
    }
  }
  if (next.ast_target && typeof next.ast_target === 'object' && !Array.isArray(next.ast_target)) {
    const nestedPath = next.ast_target.path;
    if (typeof nestedPath === 'string' && nestedPath.trim()) {
      const remapped = remapCrewParentPath(nestedPath, worktreeRoot);
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

export async function isCrewWorktreeDirty(worktreePath) {
  const cwd = path.resolve(worktreePath);
  const status = await tryGit(cwd, ['status', '--porcelain']);
  return Boolean(String(status.stdout || '').trim());
}

export function crewWorkerClaimedBlocked(text) {
  return /\b(blocked|failed|cannot finish|can't finish|can’t finish)\b/i.test(String(text || ''));
}

export function composeCrewWorkerSealNudge(kind = 'coder') {
  if (kind === 'survey') {
    return 'Survey workers must not change files. Revert any edits in this worktree and stop. Do not git commit product code.';
  }
  return 'Worktree is still dirty (not sealed). If the slice is done, git add the files in your paths and git commit on this branch now. If you cannot finish, do not commit; reply with blocked or failed and stop.';
}

export function decideCrewWorkerSeal({
  dirty = false,
  kind = 'coder',
  text = '',
  nudgeCount = 0,
} = {}) {
  if (nudgeCount >= CREW_WORKER_SEAL_MAX_NUDGES) return { continue: false };
  if (!dirty) return { continue: false };
  if (kind === 'survey') {
    return { continue: true, content: composeCrewWorkerSealNudge('survey') };
  }
  if (crewWorkerClaimedBlocked(text)) return { continue: false };
  return { continue: true, content: composeCrewWorkerSealNudge('coder') };
}

export async function shouldContinueCrewWorkerSeal({
  worktreePath,
  kind = 'coder',
  text = '',
  nudgeCount = 0,
} = {}) {
  const dirty = await isCrewWorktreeDirty(worktreePath).catch(() => true);
  return decideCrewWorkerSeal({ dirty, kind, text, nudgeCount });
}

async function worktreePathExists(worktreePath) {
  try {
    const stat = await fs.stat(worktreePath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export function withCrewGitLock(cwd, fn) {
  return withSpawnLock(cwd, fn);
}

export async function addCrewWorktree(options = {}) {
  return withSpawnLock(options.cwd || process.cwd(), () => addCrewWorktreeUnlocked(options));
}

async function addCrewWorktreeUnlocked({
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
    return { ok: false, code: 'NO_BASE', error: 'Crew spawn needs a recorded git base branch.' };
  }
  const survey = String(kind || '').trim().toLowerCase() === 'survey';
  const normalizedPaths = normalizeCrewPaths(paths);
  if (!survey && normalizedPaths.length === 0) {
    return {
      ok: false,
      code: 'PATHS_REQUIRED',
      error: 'Crew run_subagent requires paths: an array of relative globs such as docs/** or src/foo.ts.',
    };
  }
  const current = await readCrewStateFile(root);
  const existing = listCrewWorkersFromState(current);
  if (!survey) {
    const overlap = findOverlappingCrewWorker(normalizedPaths, existing);
    if (overlap) {
      const workerId = String(overlap.worker?.id || 'worker').trim() || 'worker';
      return {
        ok: false,
        code: 'SCOPE_OVERLAP',
        error: `Crew scope overlaps worker "${workerId}" (${overlap.existing} vs ${overlap.glob}). Change paths and retry.`,
        workerId,
        glob: overlap.glob,
        existing: overlap.existing,
      };
    }
  }
  const preferred = preferredCrewWorkerId({ taskId, name, callId });
  if (
    preferred
    && !RESERVED_WORKER_IDS.has(preferred)
    && existing.some((item) => item.id === preferred && crewWorkerBlocksSpawn(item))
  ) {
    return {
      ok: false,
      code: 'WORKER_EXISTS',
      error: `Crew worker "${preferred}" already exists. Call run_subagent with resume: "${preferred}".`,
      workerId: preferred,
    };
  }
  const workerId = allocateCrewWorkerId({
    taskId,
    name,
    callId,
    existingIds: existing.map((item) => item.id),
  });
  const branch = crewWorkerBranchName(workerId);
  const worktreePath = path.resolve(getProjectCrewWorktreesDir(root), workerId);
  await fs.mkdir(path.dirname(worktreePath), { recursive: true });
  if (await worktreePathExists(worktreePath)) {
    return {
      ok: false,
      code: 'WORKTREE_EXISTS',
      error: `Crew worktree already exists: ${worktreePath}`,
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
  const normalizedDependsOn = normalizeCrewDependsOn(dependsOn);
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
  const saved = await appendCrewWorkerRecord(root, worker);
  if (!saved.ok) {
    await tryGit(root, ['worktree', 'remove', '--force', worktreePath]);
    return saved;
  }
  return { ok: true, worker: saved.worker || worker };
}

export async function removeCrewWorktree({
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
  if (!force && await isCrewWorktreeDirty(worktreePath)) {
    return { ok: false, skipped: true, dirty: true, worker };
  }
  const removed = await tryGit(root, [
    'worktree',
    'remove',
    ...(force ? ['--force'] : []),
    worktreePath,
  ]);
  if (removed.code !== 0) {
    const dirty = await isCrewWorktreeDirty(worktreePath);
    if (dirty && !force) return { ok: false, skipped: true, dirty: true, worker };
    return {
      ok: false,
      error: String(removed.stderr || removed.stdout || '').trim() || 'Failed to remove worktree.',
      worker,
    };
  }
  return { ok: true, removed: true, worker };
}

export async function teardownCrewWorker({
  cwd = process.cwd(),
  id = '',
  force = true,
} = {}) {
  const workerId = String(id || '').trim();
  if (!workerId) return { ok: false, error: 'Missing Crew worker id.' };
  return withSpawnLock(cwd, async () => {
    const root = path.resolve(cwd);
    const workers = listCrewWorkersFromState(await readCrewStateFile(root));
    const worker = workers.find((item) => item.id === workerId);
    if (!worker) return { ok: false, code: 'NOT_FOUND', error: `Unknown Crew worker "${workerId}".` };
    const worktree = await removeCrewWorktree({ cwd: root, worker, force });
    const branch = String(worker.branch || '').trim();
    if (branch.startsWith(BRANCH_PREFIX) && !RESERVED_WORKER_IDS.has(worker.id)) {
      await tryGit(root, ['branch', '-D', branch]);
    }
    await writeCrewWorkerRecords(root, workers.filter((item) => item.id !== workerId));
    await tryGit(root, ['worktree', 'prune']);
    return {
      ok: true,
      worker,
      worktreeRemoved: worktree.removed === true || worktree.missing === true,
    };
  });
}

export async function removeCrewWorktrees({ cwd = process.cwd(), force = false, skipLock = false } = {}) {
  const run = async () => {
    const root = path.resolve(cwd);
    const current = await readCrewStateFile(root);
    const workers = listCrewWorkersFromState(current);
    const kept = [];
    const removed = [];
    for (const worker of workers) {
      const result = await removeCrewWorktree({ cwd: root, worker, force });
      if (result.ok && (result.removed || result.missing)) removed.push(worker);
      else kept.push(worker);
    }
    await writeCrewWorkerRecords(root, kept);
    return { ok: true, removed, kept };
  };
  return skipLock ? run() : withSpawnLock(cwd, run);
}
