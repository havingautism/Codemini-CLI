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
    ...(runStatus === 'running' || runStatus === 'completed' || runStatus === 'failed'
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

export function buildTowerModePromptBlock(towerState, workers = []) {
  const state = normalizeTowerState(towerState);
  if (!state) return '';
  const roster = listTowerWorkersFromState({ workers });
  const formatRoster = (items) => items.map((item) => {
    const scope = Array.isArray(item.paths) && item.paths.length ? item.paths.join(', ') : 'no paths';
    const status = String(item.runStatus || '').trim();
    return status ? `${item.id} (${scope}, ${status})` : `${item.id} (${scope})`;
  }).join('; ');
  const idle = roster.filter((item) => item.integrated !== true);
  const onBase = roster.filter((item) => item.integrated === true);
  const rosterParts = [];
  if (idle.length) {
    rosterParts.push(`Idle workers: ${formatRoster(idle)}. Call back with resume: "<id>". That id is the short worker name such as alisa, never a call id or handoff folder.`);
  } else if (onBase.length) {
    rosterParts.push('No idle workers. Everyone still on the roster is already merged onto the base branch.');
  } else {
    rosterParts.push('No idle workers yet. New workers need a unique short name and disjoint paths.');
  }
  if (onBase.length) {
    rosterParts.push(`On base: ${formatRoster(onBase)}. Do not resume or review those workers. Wait for the rest of the roster, then land_workers.`);
  }
  const rosterLine = rosterParts.join(' ');
  return [
    'Tower Mode: on',
    `Recorded git base branch: ${state.base}`,
    'You are the control tower for this session. Any user objective — including a single task — must be dispatched with run_subagent. One worker is enough; do not invent extra missions. Do not implement, answer the coding question yourself, or edit the main checkout.',
    'Coder workers get a git worktree each. Do not create worktrees, extra branches, or merge into the user branch yourself.',
    'New coder workers require paths: disjoint relative globs such as docs/** or src/foo.ts. Overlapping paths are rejected unless that other worker is already integrated onto the base branch. Resume with resume set to that id; omit paths to keep the stored list, or pass a new disjoint list to change it.',
    'Read-only investigation uses role: "survey". Survey workers still get a worktree, do not take exclusive paths, must not edit or commit, and are not reviewed or landed.',
    rosterLine,
    'When a coder worker finishes, read its tool result. dirty means it did not git commit — do not review or land that worker. After a coder is sealed, dispatch a separate run_subagent with role: "reviewer" and review set to that worker id. Do not resume the author to review themselves. The reviewer is not a roster worker and does not get paths or a new worktree. Do not review survey workers. fork_task is not available; do not use it.',
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
