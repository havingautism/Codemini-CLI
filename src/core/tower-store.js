import fs from 'node:fs/promises';
import path from 'node:path';

import { getProjectTowerDir, getProjectTowerStatePath } from './paths.js';
import { runGit } from './process-run.js';
import { normalizeTowerDependsOn, normalizeTowerPaths } from './tower-scope.js';

const TOWER_STATE_VERSION = 1;

export function parseTowerSlashCommand(text) {
  const value = String(text || '').trim();
  const match = value.match(/^\/tower(?:\s+(.*))?$/i);
  if (!match) return null;
  const arg = String(match[1] || '').trim().toLowerCase();
  if (arg === 'off' || arg === 'teardown') return { action: 'exit' };
  return { action: 'enter' };
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
    ...(rebaseOnto ? { rebaseOnto } : {}),
    ...(landBase ? { landBase } : {}),
  };
}

export function workerLandBaseRef(worker, fallback = '') {
  return String(worker?.landBase || '').trim() || String(fallback || '').trim();
}

export function towerReviewPassedFromText(text) {
  const value = String(text || '');
  const bulletMatch = value.match(/(?:^|\n)\s*Findings\s*:\s*(?:\n|\r\n?)+\s*-\s*([^\n\r]+)/i);
  const inlineMatch = value.match(/(?:^|\n)\s*Findings\s*:\s*([^\n\r]+)/i);
  const bullet = String(bulletMatch?.[1] || inlineMatch?.[1] || '').trim();
  if (!bullet) return false;
  return /^none\b/i.test(bullet);
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

export function buildTowerModePromptBlock(towerState, workers = []) {
  const state = normalizeTowerState(towerState);
  if (!state) return '';
  const roster = listTowerWorkersFromState({ workers });
  const rosterLine = roster.length
    ? `Idle workers: ${roster.map((item) => {
      const scope = Array.isArray(item.paths) && item.paths.length ? item.paths.join(', ') : 'no paths';
      return `${item.id} (${scope})`;
    }).join('; ')}. Call back with resume: "<id>". That id is the short worker name such as alisa, never a call id or handoff folder.`
    : 'No idle workers yet. New workers need a unique short name and disjoint paths.';
  return [
    'Tower Mode: on',
    `Recorded git base branch: ${state.base}`,
    'You are the control tower for this session. Do not write product code or edit implementation files in the main checkout.',
    'Delegate isolated work with run_subagent. Isolation uses a git worktree per subagent; do not create worktrees, extra branches, or merge into the user branch yourself.',
    'New workers require paths: disjoint relative globs such as docs/** or src/foo.ts. Overlapping paths are rejected; change paths and retry.',
    rosterLine,
    'When a worker finishes, read its tool result. dirty means it did not git commit — do not land that worker. After a worker is sealed, dispatch a separate run_subagent with role: "reviewer" and review set to that worker id. Do not resume the author to review themselves. The reviewer does not get paths or a new worktree.',
    'land_workers only lands workers whose current commit already has a passing review. If review did not pass, resume that worker with the review text, then review the new commit. If land returns REBASE_REQUIRED, resume that worker; the resume task already includes git rebase onto that commit. After it commits, review the new commit before landing again. Do not check out or delete the merge tmp branch. Successful land deletes worker branches; do not check them out.',
    'Do not git merge, git squash, or copy worker files into the main checkout yourself.',
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
      message: 'Tower needs a git repository with at least one commit.'
    };
  }
  const hasCommit = await tryGit(root, ['rev-list', '-n', '1', '--all']);
  if (hasCommit.code !== 0 || !String(hasCommit.stdout || '').trim()) {
    return {
      ok: false,
      code: 'NO_COMMIT',
      message: 'Tower needs a git repository with at least one commit.'
    };
  }
  const branchResult = await tryGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const base = String(branchResult.stdout || '').trim();
  if (branchResult.code !== 0 || !base || base === 'HEAD') {
    return {
      ok: false,
      code: 'DETACHED',
      message: 'Tower cannot start from a detached HEAD. Check out a branch first.'
    };
  }
  return { ok: true, base };
}

export async function readTowerStateFile(cwd = process.cwd()) {
  try {
    const raw = await fs.readFile(getProjectTowerStatePath(cwd), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function writeTowerStateFile(cwd, state) {
  const dir = getProjectTowerDir(cwd);
  await fs.mkdir(dir, { recursive: true });
  const file = getProjectTowerStatePath(cwd);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, file);
  return file;
}

export async function appendTowerWorkerRecord(cwd, worker) {
  const record = normalizeTowerWorkerRecord(worker);
  if (!record) return { ok: false, error: 'Invalid tower worker record.' };
  const current = (await readTowerStateFile(cwd)) || {};
  const workers = listTowerWorkersFromState(current);
  if (workers.some((item) => item.id === record.id || item.worktreePath === record.worktreePath)) {
    return { ok: false, error: `Duplicate tower worker "${record.id}".` };
  }
  workers.push(record);
  await writeTowerStateFile(cwd, { ...current, workers });
  return { ok: true, worker: record, workers };
}

export async function writeTowerWorkerRecords(cwd, workers) {
  const current = (await readTowerStateFile(cwd)) || {};
  const next = (Array.isArray(workers) ? workers : [])
    .map(normalizeTowerWorkerRecord)
    .filter(Boolean);
  await writeTowerStateFile(cwd, { ...current, workers: next });
  return next;
}

export async function patchTowerWorkerRecord(cwd, id, patch = {}) {
  const workerId = String(id || '').trim();
  if (!workerId) return { ok: false, error: 'Missing tower worker id.' };
  const current = (await readTowerStateFile(cwd)) || {};
  const workers = listTowerWorkersFromState(current);
  const index = workers.findIndex((item) => item.id === workerId);
  if (index < 0) return { ok: false, error: `Unknown tower worker "${workerId}".` };
  const next = normalizeTowerWorkerRecord({
    ...workers[index],
    ...(patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}),
    id: workers[index].id,
    branch: workers[index].branch,
    worktreePath: workers[index].worktreePath,
  });
  if (!next) return { ok: false, error: 'Invalid tower worker record.' };
  workers[index] = next;
  await writeTowerStateFile(cwd, { ...current, workers });
  return { ok: true, worker: next, workers };
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
  const priorWorkers = listTowerWorkersFromState(await readTowerStateFile(cwd));
  await writeTowerStateFile(cwd, {
    version: TOWER_STATE_VERSION,
    ...tower,
    sessionId: String(sessionId || '').trim() || undefined,
    workers: priorWorkers
  });
  return { ok: true, tower };
}

export async function exitTowerMode({ cwd = process.cwd(), sessionId = '', previous } = {}) {
  const disk = await readTowerStateFile(cwd);
  const prior = normalizeTowerState(previous) || normalizeTowerState(disk);
  const now = new Date().toISOString();
  await writeTowerStateFile(cwd, {
    version: TOWER_STATE_VERSION,
    active: false,
    base: prior?.base || '',
    enteredAt: prior?.enteredAt,
    exitedAt: now,
    sessionId: String(sessionId || '').trim() || undefined,
    workers: listTowerWorkersFromState(disk)
  }).catch(() => null);
  return { ok: true, tower: null };
}
