import fs from 'node:fs/promises';
import path from 'node:path';

import { getProjectCrewDir, getProjectCrewStatePath } from './paths.js';
import { runGit } from './process-run.js';
import { atomicWriteUtf8 } from './staged-write.js';
import { normalizeCrewDependsOn, normalizeCrewPaths } from './crew-scope.js';

const CREW_STATE_VERSION = 1;
const CREW_EVENTS_LIMIT = 50;
const CREW_EVENT_KINDS = new Set([
  'worker.completed',
  'worker.failed',
  'worker.interrupted',
  'review.completed',
]);
const crewStateLocks = new Map();

function crewStateLockKey(cwd) {
  const key = path.resolve(getProjectCrewStatePath(cwd));
  return process.platform === 'win32' ? key.toLowerCase() : key;
}

function withCrewStateLock(cwd, task) {
  const key = crewStateLockKey(cwd);
  const previous = crewStateLocks.get(key) || Promise.resolve();
  const run = previous.catch(() => {}).then(task);
  crewStateLocks.set(key, run);
  return run.finally(() => {
    if (crewStateLocks.get(key) === run) crewStateLocks.delete(key);
  });
}

export function normalizeCrewState(value) {
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

export function normalizeCrewWorkerRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = String(value.id || '').trim();
  const branch = String(value.branch || '').trim();
  const worktreePath = String(value.worktreePath || '').trim();
  if (!id || !branch || !worktreePath) return null;
  const callId = String(value.callId || '').trim();
  const taskId = String(value.taskId || '').trim();
  const paths = normalizeCrewPaths(value.paths);
  const dependsOn = normalizeCrewDependsOn(value.dependsOn);
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

export const CREW_REVIEW_MAX_ROUNDS = 5;

export function buildCrewReviewVerdictPrompt() {
  return [
    'Crew review verdict (required before you stop):',
    'Call submit_crew_review exactly once. Prose under Findings: does not record the verdict for landing.',
    'Clean to land: submit_crew_review with passed true and findings [].',
    'Blocking issues: submit_crew_review with passed false and one findings item per issue.',
    'Do not pass placeholder findings like "none" when passed is true — use an empty array.',
    'You may still write Findings:/Verified: for the handoff, but the tool call is mandatory.',
  ].join('\n');
}

const NO_FINDING_SENTINELS = new Set([
  'none',
  'n/a',
  'na',
  'no findings',
  'no issues',
  'no issue',
  'nothing',
  '-',
  '—',
]);

export function isNoFindingSentinel(value = '') {
  const key = normalizeFindingsBullet(String(value || '').replace(/^[-–—]\s*/, ''));
  return !key || NO_FINDING_SENTINELS.has(key);
}

export function sanitizeCrewReviewFindings(findings = [], { passed } = {}) {
  const list = Array.isArray(findings) ? findings : [];
  const cleaned = [...new Set(list.map((item) => String(item || '').trim()).filter(Boolean))];
  if (passed !== true) return cleaned;
  return cleaned.filter((item) => !isNoFindingSentinel(item));
}

export function normalizeCrewReviewVerdict(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'submit_crew_review requires passed and findings.' };
  }
  if (value.passed !== true && value.passed !== false) {
    return { ok: false, error: 'passed must be true or false.' };
  }
  const findings = sanitizeCrewReviewFindings(value.findings, { passed: value.passed });
  if (value.passed === true && findings.length > 0) {
    return { ok: false, error: 'passed:true requires findings to be empty.' };
  }
  if (value.passed === false && findings.length === 0) {
    return { ok: false, error: 'passed:false requires at least one finding.' };
  }
  return { ok: true, passed: value.passed === true, findings };
}

export function inferCrewReviewVerdictFromOutput(text = '') {
  const body = String(text || '').trim();
  if (!body) return null;
  const findingsMatch = body.match(/findings:\s*([\s\S]*?)(?:\n\s*(?:verified|not verified|handoff|summary):|\n\n|$)/i);
  const findingsBlock = findingsMatch ? findingsMatch[1] : '';
  const findingLines = findingsBlock
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean);
  const onlyNone = findingLines.length === 0
    || findingLines.every((item) => isNoFindingSentinel(item));
  const passHints = /\b(pass(?:ed)?|approve(?:d)?|clean to land|may land|可合入|审查通过|复审结论[:：]\s*\*\*pass\*\*|干净可合入)\b/i.test(body);
  const failHints = /\b(fail(?:ed|ure)?|reject(?:ed)?|block(?:ed|ing)?|cannot land|不通过|未通过)\b/i.test(body);
  if (onlyNone && passHints && !failHints) {
    return { status: 'passed', passed: true, findings: [] };
  }
  return null;
}

export function resolveCrewReviewOutcome({ verdict, outputText = '' } = {}) {
  if (verdict && typeof verdict === 'object' && verdict.passed === true) {
    return {
      status: 'passed',
      passed: true,
      findings: sanitizeCrewReviewFindings(verdict.findings, { passed: true }),
      source: 'tool',
    };
  }
  if (verdict && typeof verdict === 'object' && verdict.passed === false) {
    return {
      status: 'failed',
      passed: false,
      findings: sanitizeCrewReviewFindings(verdict.findings, { passed: false }),
      source: 'tool',
    };
  }
  const inferred = inferCrewReviewVerdictFromOutput(outputText);
  if (inferred) return { ...inferred, source: 'inferred' };
  return { status: 'incomplete', passed: undefined, findings: [], source: 'none' };
}

export async function applyCrewReviewOutcome({
  cwd,
  workerId,
  workerRecord,
  reviewCommit,
  verdict,
  outputText = '',
} = {}) {
  const id = String(workerId || '').trim();
  const commit = String(reviewCommit || '').trim();
  if (!id || !commit) {
    return {
      outcome: { status: 'incomplete', passed: undefined, findings: [], source: 'none' },
      reviewPassed: undefined,
      reviewIncomplete: true,
      reviewLoopStopped: false,
      reviewRound: 0,
    };
  }
  const outcome = resolveCrewReviewOutcome({ verdict, outputText });
  if (outcome.status === 'passed') {
    const loop = nextCrewReviewLoopState(workerRecord, { passed: true, findings: [] });
    await patchCrewWorkerRecord(cwd, id, {
      reviewedCommit: commit,
      reviewPassed: true,
      reviewText: '',
      ...loop,
    }).catch(() => null);
    return {
      outcome,
      reviewPassed: true,
      reviewIncomplete: false,
      reviewLoopStopped: loop.reviewLoopStopped,
      reviewRound: loop.reviewRound,
    };
  }
  if (outcome.status === 'failed') {
    const loop = nextCrewReviewLoopState(workerRecord, {
      passed: false,
      findings: outcome.findings,
    });
    await patchCrewWorkerRecord(cwd, id, {
      reviewedCommit: commit,
      reviewPassed: false,
      reviewText: formatCrewReviewText({ passed: false, findings: outcome.findings }),
      ...loop,
    }).catch(() => null);
    return {
      outcome,
      reviewPassed: false,
      reviewIncomplete: false,
      reviewLoopStopped: loop.reviewLoopStopped,
      reviewRound: loop.reviewRound,
    };
  }
  const reviewText = String(outputText || '').trim();
  await patchCrewWorkerRecord(cwd, id, {
    ...(reviewText ? { reviewText: reviewText.slice(0, 4000) } : {}),
  }).catch(() => null);
  return {
    outcome,
    reviewPassed: undefined,
    reviewIncomplete: true,
    reviewLoopStopped: false,
    reviewRound: 0,
  };
}

function normalizeFindingsBullet(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function crewReviewFindingsKey(findings = []) {
  const list = Array.isArray(findings) ? findings : [];
  return list.map(normalizeFindingsBullet).filter(Boolean).join('\n');
}

export function formatCrewReviewText(verdict) {
  if (!verdict || typeof verdict !== 'object') return '';
  if (verdict.passed === true) return '';
  const findings = Array.isArray(verdict.findings) ? verdict.findings : [];
  return findings.map((item) => `- ${String(item || '').trim()}`).filter((item) => item !== '-').join('\n');
}

export function nextCrewReviewLoopState(worker, { passed = false, findings = [] } = {}) {
  if (passed === true) {
    return {
      reviewRound: 0,
      lastFindingsKey: '',
      reviewLoopStopped: false,
    };
  }
  const prevRound = Number.parseInt(String(worker?.reviewRound ?? ''), 10);
  const reviewRound = (Number.isInteger(prevRound) && prevRound > 0 ? prevRound : 0) + 1;
  const lastFindingsKey = crewReviewFindingsKey(findings);
  const prevKey = String(worker?.lastFindingsKey || '').trim();
  const sameFindings = Boolean(prevKey && lastFindingsKey && prevKey === lastFindingsKey);
  const reviewLoopStopped = worker?.reviewLoopStopped === true
    || reviewRound >= CREW_REVIEW_MAX_ROUNDS
    || sameFindings;
  return { reviewRound, lastFindingsKey, reviewLoopStopped };
}

export function formatCrewReviewLoopStoppedError(worker) {
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

export function listCrewWorkersFromState(state) {
  const workers = Array.isArray(state?.workers) ? state.workers : [];
  return workers.map(normalizeCrewWorkerRecord).filter(Boolean);
}

export function normalizeCrewEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = String(value.id || '').trim();
  const kind = String(value.kind || '').trim();
  const from = String(value.from || '').trim();
  const to = String(value.to || '').trim() || 'coordinator';
  const at = String(value.at || '').trim();
  if (!id || !CREW_EVENT_KINDS.has(kind) || !from || !at) return null;
  const payload = value.payload && typeof value.payload === 'object' && !Array.isArray(value.payload)
    ? value.payload
    : {};
  return {
    id,
    kind,
    from,
    to,
    at,
    delivered: value.delivered === true,
    payload,
  };
}

export function listCrewEventsFromState(state) {
  const events = Array.isArray(state?.events) ? state.events : [];
  return events.map(normalizeCrewEvent).filter(Boolean);
}

export function listUnreadCrewEvents(state, { to = 'coordinator', limit = 12 } = {}) {
  const unread = listCrewEventsFromState(state).filter((item) => (
    item.delivered !== true && item.to === (String(to || '').trim() || 'coordinator')
  ));
  const cap = Number.isInteger(limit) && limit > 0 ? limit : 12;
  return unread.slice(-cap);
}

export function parseCrewWakeNotification(wakeText = '') {
  const text = String(wakeText || '');
  const match = text.match(/<notification type="([^"]+)" workerId="([^"]+)"/);
  if (!match) return null;
  const type = String(match[1] || '').trim();
  const workerId = String(match[2] || '').trim();
  if (!workerId) return null;
  let kind = '';
  if (type === 'crew.review.completed') kind = 'review.completed';
  else if (type === 'crew.worker.completed') kind = 'worker.completed';
  else if (type === 'crew.worker.failed') kind = 'worker.failed';
  else if (type === 'crew.worker.interrupted') kind = 'worker.interrupted';
  return { type, workerId, kind: kind || undefined };
}

export function markCrewEventsDeliveredInState(state, { eventIds = [], from = '', kind = '' } = {}) {
  const idSet = new Set(
    (Array.isArray(eventIds) ? eventIds : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean),
  );
  const fromId = String(from || '').trim();
  const eventKind = String(kind || '').trim();
  let marked = 0;
  const events = listCrewEventsFromState(state).map((event) => {
    if (event.delivered === true) return event;
    const byId = idSet.size > 0 && idSet.has(event.id);
    const byWake = fromId
      && event.from === fromId
      && (!eventKind || event.kind === eventKind);
    if (byId || byWake) {
      marked += 1;
      return { ...event, delivered: true };
    }
    return event;
  });
  return { events, marked };
}

export function markCrewEventsDelivered(cwd, options = {}) {
  return withCrewStateLock(cwd, async () => {
    const current = (await readCrewStateFile(cwd)) || {};
    const { events, marked } = markCrewEventsDeliveredInState(current, options);
    if (!marked) return { ok: true, marked: 0 };
    await writeCrewStateFileUnlocked(cwd, composeCrewStateDocument(current, { events }));
    return { ok: true, marked };
  });
}

export function markCrewEventsDeliveredForWake(cwd, wakeText = '') {
  const note = parseCrewWakeNotification(wakeText);
  if (!note) return markCrewEventsDelivered(cwd, { eventIds: [] });
  return markCrewEventsDelivered(cwd, { from: note.workerId, kind: note.kind });
}

function capCrewEvents(events) {
  const list = Array.isArray(events) ? events : [];
  if (list.length <= CREW_EVENTS_LIMIT) return list;
  return list.slice(list.length - CREW_EVENTS_LIMIT);
}

export function composeCrewStateDocument(current = {}, patch = {}) {
  const base = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  const overlay = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  const workers = overlay.workers !== undefined
    ? (Array.isArray(overlay.workers) ? overlay.workers : [])
      .map(normalizeCrewWorkerRecord)
      .filter(Boolean)
    : listCrewWorkersFromState(base);
  const events = overlay.events !== undefined
    ? capCrewEvents(listCrewEventsFromState({ events: overlay.events }))
    : listCrewEventsFromState(base);
  return { ...base, ...overlay, workers, events };
}

export function buildCrewCompletionEvent(input = {}) {
  const workerId = String(input.workerId || '').trim();
  const reviewOf = String(input.reviewOf || '').trim();
  const status = String(input.status || 'completed').trim().toLowerCase() || 'completed';
  const from = reviewOf || workerId;
  if (!from) return null;
  const failed = status === 'failed';
  const interrupted = status === 'interrupted';
  const isReview = Boolean(reviewOf);
  let kind = 'worker.completed';
  if (interrupted) kind = 'worker.interrupted';
  else if (isReview) kind = 'review.completed';
  else if (failed) kind = 'worker.failed';
  const payload = {
    workerId: from,
    status: interrupted ? 'interrupted' : (failed ? 'failed' : 'completed'),
  };
  if (input.dirty === true || input.dirty === false) payload.dirty = input.dirty === true;
  const workerKind = String(input.workerKind || '').trim();
  if (workerKind) payload.workerKind = workerKind;
  const summary = String(input.summary || '').trim();
  if (summary) payload.summary = summary.slice(0, 200);
  const handoffPath = String(input.handoffPath || '').trim();
  if (handoffPath) payload.handoffPath = handoffPath;
  if (input.reviewPassed === true || input.reviewPassed === false) {
    payload.reviewPassed = input.reviewPassed === true;
  }
  if (input.reviewIncomplete === true) payload.reviewIncomplete = true;
  if (input.reviewLoopStopped === true) payload.reviewLoopStopped = true;
  const reviewRound = Number.parseInt(String(input.reviewRound ?? ''), 10);
  if (Number.isInteger(reviewRound) && reviewRound > 0) payload.reviewRound = reviewRound;
  return {
    id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    kind,
    from,
    to: 'coordinator',
    at: new Date().toISOString(),
    delivered: false,
    payload,
  };
}

export function appendCrewEvent(cwd, event) {
  return withCrewStateLock(cwd, async () => {
    const record = normalizeCrewEvent(event);
    if (!record) return { ok: false, error: 'Invalid Crew event.' };
    const current = (await readCrewStateFile(cwd)) || {};
    const events = capCrewEvents([...listCrewEventsFromState(current), record]);
    await writeCrewStateFileUnlocked(cwd, composeCrewStateDocument(current, { events }));
    return { ok: true, event: record, events };
  });
}

export function buildCrewModePromptBlock(crewState) {
  const state = normalizeCrewState(crewState);
  if (!state) return '';
  return [
    'Crew Mode: on',
    `Recorded git base branch: ${state.base}`,
    'You are the Crew coordinator for this session. Dispatch implementation work with run_subagent. One worker is enough; do not invent extra missions. Do not implement, answer the coding question yourself, or edit the main checkout.',
    'Call crew_status for the live roster before dispatching, reviewing, landing, or answering progress. Do not infer progress from this prompt, memory, or an earlier tool result. crew_status also lists recent completion events; after a restart a wake may be missing — use those events and the roster.',
    'User progress or status questions (for example "做到哪了", "进展如何", "还要多久") are not new missions. Call crew_status, then answer in plain language. Do not spawn workers, reviewers, or survey runs, and do not call land_workers, just to answer a status question.',
    'If crew_status shows pending wakes, wait for that notification turn. Do not land or dispatch while a wake is queued.',
    'When a turn includes both a user message and a Crew notification, handle the notification workflow first (review sealed coders, land when ready), then answer any user status question in the same reply.',
    'Coder workers get a git worktree each. Do not create worktrees, extra branches, or merge into the user branch yourself.',
    'New coder workers require paths: disjoint relative globs such as docs/** or src/foo.ts. Overlapping paths are rejected unless that other worker is already integrated onto the base branch. Resume with resume set to that id from crew_status; omit paths to keep the stored list, or pass a new disjoint list to change it.',
    'Read-only investigation uses role: "survey". Survey workers still get a worktree, do not take exclusive paths, must not edit or commit, and are not reviewed or landed.',
    'Crew workers run in the background. Capacity is bounded; excess workers remain queued and still count as in flight. run_subagent returns immediately with status running or queued; completion wakes you in a new turn via a Crew notification. Use crew_status and the wake notification — not the original tool result — to decide the next step. dirty means the worker did not git commit — do not review or land that worker. After a coder is sealed, dispatch a separate run_subagent with role: "reviewer" and review set to that worker id. Reviewers also run in the background. Do not resume the author to review themselves. The reviewer is not a roster worker and does not get paths or a new worktree. Do not review survey workers. fork_task is not available; do not use it.',
    'If the user changes, narrows, or revokes a worker assignment (different path, file type, or scope), call cancel_worker for that roster id, then run_subagent with the updated task. This applies while the worker is running, queued, or sealed before review/land. Do not answer that in-flight workers cannot be interrupted, and do not defer with "wait for completion then resume" when cancel_worker can apply the change now.',
    'cancel_worker aborts that worker or its in-flight review. Cancelling a coder (running, queued, or idle) deletes its worktree, branch, and roster slot so those paths can be reused. Cancelling while a review is in flight only stops the reviewer and keeps the author worktree; call cancel_worker again to remove the worker. Do not use it for ordinary coding-mode subagents.',
    'land_workers merges each passing worker directly onto the recorded base branch with git merge --no-ff (one merge commit per worker). Workers still in review stay on their worktrees until they pass. When everyone on the roster is integrated, worker branches and worktrees are deleted. The user still controls push. If review did not pass, resume that worker with the review text, then review the new commit. If a review loop stops (5 rounds still failing, or two consecutive identical failed findings), tell the user; resume with a new task or paths, or spawn a new worker; do not keep fixing the same findings. If land returns REBASE_REQUIRED, resume that worker; the resume task already includes git rebase onto that commit. After it commits, review the new commit before landing again.',
    'Parent run is inspect-only: git status, log, diff, and other read-only commands. Do not git merge, checkout, worktree, or copy into the main checkout; land_workers is the only merge path.',
    'Tell workers to use paths relative to their worktree cwd. Do not pass absolute paths from the parent checkout.'
  ].join('\n');
}

async function tryGit(cwd, args) {
  return runGit(args, { cwd, allowFailure: true, timeoutMs: 15_000 });
}

export async function inspectCrewGit(cwd = process.cwd()) {
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
      message: 'Git · Create the initial commit manually, then select Crew again. Codemini will not create the first commit for you.'
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

export async function readCrewStateFile(cwd = process.cwd()) {
  try {
    const raw = await fs.readFile(getProjectCrewStatePath(cwd), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeCrewStateFileUnlocked(cwd, state) {
  const dir = getProjectCrewDir(cwd);
  await fs.mkdir(dir, { recursive: true });
  const file = getProjectCrewStatePath(cwd);
  await atomicWriteUtf8(file, `${JSON.stringify(state, null, 2)}\n`);
  return file;
}

export function writeCrewStateFile(cwd, state) {
  return withCrewStateLock(cwd, async () => {
    const current = (await readCrewStateFile(cwd)) || {};
    return writeCrewStateFileUnlocked(cwd, composeCrewStateDocument(current, state));
  });
}

export function appendCrewWorkerRecord(cwd, worker) {
  return withCrewStateLock(cwd, async () => {
    const record = normalizeCrewWorkerRecord(worker);
    if (!record) return { ok: false, error: 'Invalid Crew worker record.' };
    const current = (await readCrewStateFile(cwd)) || {};
    const workers = listCrewWorkersFromState(current);
    if (workers.some((item) => item.id === record.id || item.worktreePath === record.worktreePath)) {
      return { ok: false, error: `Duplicate Crew worker "${record.id}".` };
    }
    workers.push(record);
    await writeCrewStateFileUnlocked(cwd, composeCrewStateDocument(current, { workers }));
    return { ok: true, worker: record, workers };
  });
}

export function writeCrewWorkerRecords(cwd, workers) {
  return withCrewStateLock(cwd, async () => {
    const current = (await readCrewStateFile(cwd)) || {};
    const next = (Array.isArray(workers) ? workers : [])
      .map(normalizeCrewWorkerRecord)
      .filter(Boolean);
    await writeCrewStateFileUnlocked(cwd, composeCrewStateDocument(current, { workers: next }));
    return next;
  });
}

export function patchCrewWorkerRecord(cwd, id, patch = {}) {
  return withCrewStateLock(cwd, async () => {
    const workerId = String(id || '').trim();
    if (!workerId) return { ok: false, error: 'Missing Crew worker id.' };
    const current = (await readCrewStateFile(cwd)) || {};
    const workers = listCrewWorkersFromState(current);
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
    const next = normalizeCrewWorkerRecord(raw);
    if (!next) return { ok: false, error: 'Invalid Crew worker record.' };
    workers[index] = next;
    await writeCrewStateFileUnlocked(cwd, composeCrewStateDocument(current, { workers }));
    return { ok: true, worker: next, workers };
  });
}

export async function enterCrewMode({ cwd = process.cwd(), sessionId = '' } = {}) {
  const inspect = await inspectCrewGit(cwd);
  if (!inspect.ok) return inspect;
  const now = new Date().toISOString();
  const crew = {
    active: true,
    base: inspect.base,
    enteredAt: now
  };
  await withCrewStateLock(cwd, async () => {
    const disk = await readCrewStateFile(cwd);
    await writeCrewStateFileUnlocked(cwd, composeCrewStateDocument(disk, {
      version: CREW_STATE_VERSION,
      ...crew,
      sessionId: String(sessionId || '').trim() || undefined,
    }));
  });
  return {
    ok: true,
    crew,
    dirtyCount: inspect.dirtyCount || 0,
    ...(inspect.warning ? { warning: inspect.warning } : {}),
  };
}

export async function exitCrewMode({ cwd = process.cwd(), sessionId = '', previous } = {}) {
  await withCrewStateLock(cwd, async () => {
    const disk = await readCrewStateFile(cwd);
    const prior = normalizeCrewState(previous) || normalizeCrewState(disk);
    const now = new Date().toISOString();
    await writeCrewStateFileUnlocked(cwd, composeCrewStateDocument(disk, {
      version: CREW_STATE_VERSION,
      active: false,
      base: prior?.base || '',
      enteredAt: prior?.enteredAt,
      exitedAt: now,
      sessionId: String(sessionId || '').trim() || undefined,
    })).catch(() => null);
  });
  return { ok: true, crew: null };
}
