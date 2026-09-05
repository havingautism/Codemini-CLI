import fs from 'node:fs/promises';
import path from 'node:path';

import { getProjectTowerDir, getProjectTowerStatePath } from './paths.js';
import { runGit } from './process-run.js';
import { atomicWriteUtf8 } from './staged-write.js';
import { normalizeTowerDependsOn, normalizeTowerPaths } from './tower-scope.js';

const TOWER_STATE_VERSION = 1;
const towerStateLocks = new Map();

function towerStateLockKey(cwd) {
  const key = path.resolve(getProjectTowerStatePath(cwd));
  return process.platform === 'win32' ? key.toLowerCase() : key;
}

function withTowerStateLock(cwd, task) {
  const key = towerStateLockKey(cwd);
  const previous = towerStateLocks.get(key) || Promise.resolve();
  const run = previous.catch(() => {}).then(task);
  towerStateLocks.set(key, run);
  return run.finally(() => {
    if (towerStateLocks.get(key) === run) towerStateLocks.delete(key);
  });
}

export function normalizeTowerState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.active !== true) return null;
  const base = String(value.base || '').trim();
  if (!base || base === 'HEAD') return null;
  const enteredAt = String(value.enteredAt || '').trim();
  return {
    active: true,
    base,
    ...(enteredAt ? { enteredAt } : {})
  };
}

export function normalizeTowerWorkerRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = String(value.id || '').trim();
  const branch = String(value.branch || '').trim();
  const worktreePath = String(value.worktreePath || '').trim();
  if (!id || !branch || !worktreePath) return null;
  const callId = String(value.callId || '').trim();
  const taskId = String(value.taskId || '').trim();
  const paths = normalizeTowerPaths(value.paths);
  const dependsOn = normalizeTowerDependsOn(value.dependsOn);
  const lastHandoffPath = String(value.lastHandoffPath || '').trim();
  const reviewedCommit = String(value.reviewedCommit || '').trim();
  const reviewText = String(value.reviewText || '').trim();
  const rebaseOnto = String(value.rebaseOnto || '').trim();
  const landBase = String(value.landBase || '').trim();
  const reviewRound = Number.parseInt(String(value.reviewRound ?? ''), 10);
  const lastFindingsKey = String(value.lastFindingsKey || '').trim();
  const runStatus = String(value.runStatus || '').trim().toLowerCase();
  const runError = String(value.runError || '').trim();
  return {
    id,
    branch,
    worktreePath,
    ...(callId ? { callId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(paths.length ? { paths } : {}),
    ...(dependsOn.length ? { dependsOn } : {}),
    ...(lastHandoffPath ? { lastHandoffPath } : {}),
    ...(reviewedCommit ? { reviewedCommit } : {}),
    ...(value.reviewPassed === true || value.reviewPassed === false
      ? { reviewPassed: value.reviewPassed === true }
      : {}),
    ...(reviewText ? { reviewText } : {}),
    ...(Number.isInteger(reviewRound) && reviewRound > 0 ? { reviewRound } : {}),
    ...(lastFindingsKey ? { lastFindingsKey } : {}),
    ...(value.reviewLoopStopped === true ? { reviewLoopStopped: true } : {}),
    ...(value.integrated === true ? { integrated: true } : {}),
    ...(rebaseOnto ? { rebaseOnto } : {}),
    ...(landBase ? { landBase } : {}),
    ...(runStatus === 'queued' || runStatus === 'running' || runStatus === 'completed' || runStatus === 'failed'
      ? { runStatus }
      : {}),
    ...(runError ? { runError } : {}),
    ...(value.dirty === true || value.dirty === false ? { dirty: value.dirty === true } : {}),
    ...(String(value.kind || '').trim().toLowerCase() === 'survey' ? { kind: 'survey' } : {}),
  };
}

export function workerLandBaseRef(worker, fallback = '') {
  return String(worker?.landBase || '').trim() || String(fallback || '').trim();
}

export const TOWER_REVIEW_MAX_ROUNDS = 5;

export function normalizeTowerReviewVerdict(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'submit_tower_review requires passed and findings.' };
  }
  if (value.passed !== true && value.passed !== false) {
    return { ok: false, error: 'passed must be true or false.' };
  }
  const findings = Array.isArray(value.findings)
    ? [...new Set(value.findings.map((item) => String(item || '').trim()).filter(Boolean))]
    : [];
  if (value.passed === true && findings.length > 0) {
    return { ok: false, error: 'passed:true requires findings to be empty.' };
  }
  if (value.passed === false && findings.length === 0) {
    return { ok: false, error: 'passed:false requires at least one finding.' };
  }
  return { ok: true, passed: value.passed === true, findings };
}

function normalizeFindingsBullet(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function towerReviewFindingsKey(findings = []) {
  const list = Array.isArray(findings) ? findings : [];
  return list.map(normalizeFindingsBullet).filter(Boolean).join('\n');
}

export function formatTowerReviewText(verdict) {
  if (!verdict || typeof verdict !== 'object') return '';
  if (verdict.passed === true) return '';
  const findings = Array.isArray(verdict.findings) ? verdict.findings : [];
  return findings.map((item) => `- ${String(item || '').trim()}`).filter((item) => item !== '-').join('\n');
}

export function nextTowerReviewLoopState(worker, { passed = false, findings = [] } = {}) {
  if (passed === true) {
    return {
      reviewRound: 0,
      lastFindingsKey: '',
      reviewLoopStopped: false,
    };
  }
  const prevRound = Number.parseInt(String(worker?.reviewRound ?? ''), 10);
  const reviewRound = (Number.isInteger(prevRound) && prevRound > 0 ? prevRound : 0) + 1;
  const lastFindingsKey = towerReviewFindingsKey(findings);
  const prevKey = String(worker?.lastFindingsKey || '').trim();
  const sameFindings = Boolean(prevKey && lastFindingsKey && prevKey === lastFindingsKey);
  const reviewLoopStopped = worker?.reviewLoopStopped === true
    || reviewRound >= TOWER_REVIEW_MAX_ROUNDS
    || sameFindings;
  return { reviewRound, lastFindingsKey, reviewLoopStopped };
}

export function formatTowerReviewLoopStoppedError(worker) {
  const id = String(worker?.id || 'worker').trim() || 'worker';
  const round = Number.parseInt(String(worker?.reviewRound ?? ''), 10);
  const rounds = Number.isInteger(round) && round > 0 ? ` after ${round} review rounds` : '';
  return `Worker "${id}" review loop stopped${rounds}. Tell the user. Resume "${id}" with a new task or paths, or spawn a new worker. Do not keep fixing the same findings.`;
}

export function workerReviewMatchesCommit(worker, commit) {
  const sha = String(commit || '').trim();
  if (!sha || !worker) return false;
  return worker.reviewPassed === true && String(worker.reviewedCommit || '').trim() === sha;
}

export function listTowerWorkersFromState(state) {
  const workers = Array.isArray(state?.workers) ? state.workers : [];
  return workers.map(normalizeTowerWorkerRecord).filter(Boolean);
}

export function buildTowerModePromptBlock(towerState) {
  const state = normalizeTowerState(towerState);
  if (!state) return '';
  return [
    'Crew Mode: on',
    `Recorded git base branch: ${state.base}`,
    'You are the control tower for this session. Dispatch implementation work with run_subagent. One worker is enough; do not invent extra missions. Do not implement, answer the coding question yourself, or edit the main checkout.',
    'Call tower_status for the live roster before dispatching, reviewing, landing, or answering progress. Do not infer progress from this prompt, memory, or an earlier tool result.',
    'User progress or status questions (for example "做到哪了", "进展如何", "还要多久") are not new missions. Call tower_status, then answer in plain language. Do not spawn workers, reviewers, or survey runs, and do not call land_workers, just to answer a status question.',
    'If tower_status shows pending wakes, wait for that notification turn. Do not land or dispatch while a wake is queued.',
    'When a turn includes both a user message and a Crew notification, handle the notification workflow first (review sealed coders, land when ready), then answer any user status question in the same reply.',
    'Coder workers get a git worktree each. Do not create worktrees, extra branches, or merge into the user branch yourself.',
    'New coder workers require paths: disjoint relative globs such as docs/** or src/foo.ts. Overlapping paths are rejected unless that other worker is already integrated onto the base branch. Resume with resume set to that id from tower_status; omit paths to keep the stored list, or pass a new disjoint list to change it.',
    'Read-only investigation uses role: "survey". Survey workers still get a worktree, do not take exclusive paths, must not edit or commit, and are not reviewed or landed.',
    'Crew workers run in the background. Capacity is bounded; excess workers remain queued and still count as in flight. run_subagent returns immediately with status running or queued; completion wakes you in a new turn via a Crew notification. Use tower_status and the wake notification — not the original tool result — to decide the next step. dirty means the worker did not git commit — do not review or land that worker. After a coder is sealed, dispatch a separate run_subagent with role: "reviewer" and review set to that worker id. Reviewers also run in the background. Do not resume the author to review themselves. The reviewer is not a roster worker and does not get paths or a new worktree. Do not review survey workers. fork_task is not available; do not use it.',
    'land_workers merges each passing worker directly onto the recorded base branch with git merge --no-ff (one merge commit per worker). Workers still in review stay on their worktrees until they pass. When everyone on the roster is integrated, worker branches and worktrees are deleted. The user still controls push. If review did not pass, resume that worker with the review text, then review the new commit. If a review loop stops (5 rounds still failing, or two consecutive identical failed findings), tell the user; resume with a new task or paths, or spawn a new worker; do not keep fixing the same findings. If land returns REBASE_REQUIRED, resume that worker; the resume task already includes git rebase onto that commit. After it commits, review the new commit before landing again.',
    'Parent run is inspect-only: git status, log, diff, and other read-only commands. Do not git merge, checkout, worktree, or copy into the main checkout; land_workers is the only merge path.',
    'Tell workers to use paths relative to their worktree cwd. Do not pass absolute paths from the parent checkout.'
  ].join('\n');
}

async function tryGit(cwd, args) {
  return runGit(args, { cwd, allowFailure: true, timeoutMs: 15_000 });
}

export async function inspectTowerGit(cwd = process.cwd()) {
  const root = path.resolve(cwd);
  const inside = await tryGit(root, ['rev-parse', '--is-inside-work-tree']);
  if (String(inside.stdout || '').trim() !== 'true') {
    return {
      ok: false,
      code: 'NOT_GIT',
      message: 'Git · Crew needs a repository and an initial commit. Initialize git, commit once, then select Crew again.'
    };
  }
  const hasCommit = await tryGit(root, ['rev-list', '-n', '1', '--all']);
  if (hasCommit.code !== 0 || !String(hasCommit.stdout || '').trim()) {
    return {
      ok: false,
      code: 'NO_COMMIT',
      message: 'Git · Create the initial commit, then select Crew again. Codemini will not commit automatically.'
    };
  }
  const branchResult = await tryGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const base = String(branchResult.stdout || '').trim();
  if (branchResult.code !== 0 || !base || base === 'HEAD') {
    return {
      ok: false,
      code: 'DETACHED',
      message: 'Git · Check out a named branch before starting Crew.'
    };
  }
  const status = await tryGit(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  const dirtyCount = status.code === 0
    ? String(status.stdout || '').split(/\r?\n/).filter(Boolean).length
    : 0;
  const warning = dirtyCount > 0
    ? `Git · Crew workers use HEAD and will not see ${dirtyCount} uncommitted or untracked ${dirtyCount === 1 ? 'change' : 'changes'}.`
    : '';
  return {
    ok: true,
    base,
    dirty: dirtyCount > 0,
    dirtyCount,
    ...(warning ? { warning } : {}),
  };
}

export async function readTowerStateFile(cwd = process.cwd()) {
  try {
    const raw = await fs.readFile(getProjectTowerStatePath(cwd), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeTowerStateFileUnlocked(cwd, state) {
  const dir = getProjectTowerDir(cwd);
  await fs.mkdir(dir, { recursive: true });
  const file = getProjectTowerStatePath(cwd);
  await atomicWriteUtf8(file, `${JSON.stringify(state, null, 2)}\n`);
  return file;
}

export function writeTowerStateFile(cwd, state) {
  return withTowerStateLock(cwd, () => writeTowerStateFileUnlocked(cwd, state));
}

export function appendTowerWorkerRecord(cwd, worker) {
  return withTowerStateLock(cwd, async () => {
    const record = normalizeTowerWorkerRecord(worker);
    if (!record) return { ok: false, error: 'Invalid Crew worker record.' };
    const current = (await readTowerStateFile(cwd)) || {};
    const workers = listTowerWorkersFromState(current);
    if (workers.some((item) => item.id === record.id || item.worktreePath === record.worktreePath)) {
      return { ok: false, error: `Duplicate Crew worker "${record.id}".` };
    }
    workers.push(record);
    await writeTowerStateFileUnlocked(cwd, { ...current, workers });
    return { ok: true, worker: record, workers };
  });
}

export function writeTowerWorkerRecords(cwd, workers) {
  return withTowerStateLock(cwd, async () => {
    const current = (await readTowerStateFile(cwd)) || {};
    const next = (Array.isArray(workers) ? workers : [])
      .map(normalizeTowerWorkerRecord)
      .filter(Boolean);
    await writeTowerStateFileUnlocked(cwd, { ...current, workers: next });
    return next;
  });
}

export function patchTowerWorkerRecord(cwd, id, patch = {}) {
  return withTowerStateLock(cwd, async () => {
    const workerId = String(id || '').trim();
    if (!workerId) return { ok: false, error: 'Missing Crew worker id.' };
    const current = (await readTowerStateFile(cwd)) || {};
    const workers = listTowerWorkersFromState(current);
    const index = workers.findIndex((item) => item.id === workerId);
    if (index < 0) return { ok: false, error: `Unknown Crew worker "${workerId}".` };
    const raw = {
      ...workers[index],
      ...(patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}),
      id: workers[index].id,
      branch: workers[index].branch,
      worktreePath: workers[index].worktreePath,
    };
    if (patch?.scopeReleased === false) delete raw.scopeReleased;
    if (patch?.reviewedCommit === '') delete raw.reviewedCommit;
    if (patch?.reviewText === '') delete raw.reviewText;
    if (patch?.reviewPassed === false && patch?.reviewedCommit === '') delete raw.reviewPassed;
    const next = normalizeTowerWorkerRecord(raw);
    if (!next) return { ok: false, error: 'Invalid Crew worker record.' };
    workers[index] = next;
    await writeTowerStateFileUnlocked(cwd, { ...current, workers });
    return { ok: true, worker: next, workers };
  });
}

export async function enterTowerMode({ cwd = process.cwd(), sessionId = '' } = {}) {
  const inspect = await inspectTowerGit(cwd);
  if (!inspect.ok) return inspect;
  const now = new Date().toISOString();
  const tower = {
    active: true,
    base: inspect.base,
    enteredAt: now
  };
  await withTowerStateLock(cwd, async () => {
    const priorWorkers = listTowerWorkersFromState(await readTowerStateFile(cwd));
    await writeTowerStateFileUnlocked(cwd, {
      version: TOWER_STATE_VERSION,
      ...tower,
      sessionId: String(sessionId || '').trim() || undefined,
      workers: priorWorkers
    });
  });
  return {
    ok: true,
    tower,
    dirtyCount: inspect.dirtyCount || 0,
    ...(inspect.warning ? { warning: inspect.warning } : {}),
  };
}

export async function exitTowerMode({ cwd = process.cwd(), sessionId = '', previous } = {}) {
  await withTowerStateLock(cwd, async () => {
    const disk = await readTowerStateFile(cwd);
    const prior = normalizeTowerState(previous) || normalizeTowerState(disk);
    const now = new Date().toISOString();
    await writeTowerStateFileUnlocked(cwd, {
      version: TOWER_STATE_VERSION,
      active: false,
      base: prior?.base || '',
      enteredAt: prior?.enteredAt,
      exitedAt: now,
      sessionId: String(sessionId || '').trim() || undefined,
      workers: listTowerWorkersFromState(disk)
    }).catch(() => null);
  });
  return { ok: true, tower: null };
}
