import path from 'node:path';

import {
  listTowerWorkersFromState,
  normalizeTowerState,
  readTowerStateFile,
} from './tower-store.js';
import {
  buildTowerProgressItems,
  describeTowerWorkerProgress,
  formatTowerProgressLine,
  shouldShowTowerProgressDock,
} from './tower-progress.js';

export {
  buildTowerProgressItems,
  describeTowerWorkerProgress,
  formatTowerProgressLine,
  shouldShowTowerProgressDock,
};

export function resolveTowerProjectRoot(cwd = process.cwd()) {
  const normalized = path.resolve(cwd).replace(/\\/g, '/');
  const marker = '/.codemini/tower/worktrees/';
  const idx = normalized.indexOf(marker);
  if (idx >= 0) return normalized.slice(0, idx);
  return normalized;
}

export function buildTowerWorkerStatusRecord(worker = {}) {
  const kind = String(worker.kind || '').trim().toLowerCase() || 'coder';
  const runStatus = String(worker.runStatus || '').trim().toLowerCase();
  return {
    id: worker.id,
    kind,
    paths: Array.isArray(worker.paths) ? worker.paths : [],
    branch: worker.branch || '',
    runStatus,
    dirty: worker.dirty,
    sealed: worker.dirty === false && runStatus === 'completed',
    integrated: worker.integrated === true,
    reviewPassed: worker.reviewPassed,
    reviewLoopStopped: worker.reviewLoopStopped === true,
    reviewRound: Number.isInteger(worker.reviewRound) ? worker.reviewRound : 0,
    rebaseOnto: worker.rebaseOnto || '',
    landBase: worker.landBase || '',
    runError: worker.runError || '',
    lastHandoffPath: worker.lastHandoffPath || '',
    dependsOn: Array.isArray(worker.dependsOn) ? worker.dependsOn : [],
  };
}

export function suggestTowerNextAction({ workers = [], inFlight = [], pendingWakes = 0 } = {}) {
  const pending = Number(pendingWakes) || 0;
  if (pending > 0) {
    return 'A tower notification is queued. Do not land or dispatch; wait for that wake turn.';
  }
  const roster = (Array.isArray(workers) ? workers : []).filter((item) => item.integrated !== true);
  const inFlightIds = [...new Set((Array.isArray(inFlight) ? inFlight : []).map((item) => String(item || '').trim()).filter(Boolean))];
  if (inFlightIds.length) {
    return `Wait for in-flight workers (${inFlightIds.join(', ')}) or call tower_status again before dispatching.`;
  }
  const dirty = roster.filter((item) => item.dirty === true);
  if (dirty.length) {
    return `Resume dirty workers: ${dirty.map((item) => item.id).join(', ')} before review or land.`;
  }
  const awaitingReview = roster.filter((item) => (
    item.sealed
    && item.kind !== 'survey'
    && item.reviewPassed !== true
    && item.reviewLoopStopped !== true
  ));
  if (awaitingReview.length) {
    return `Dispatch reviewer for: ${awaitingReview.map((item) => item.id).join(', ')}`;
  }
  const reviewFailed = roster.filter((item) => item.reviewPassed === false && item.reviewLoopStopped !== true);
  if (reviewFailed.length) {
    return `Resume workers with review feedback: ${reviewFailed.map((item) => item.id).join(', ')}`;
  }
  const readyToLand = roster.filter((item) => item.reviewPassed === true);
  if (readyToLand.length && roster.every((item) => item.reviewPassed === true || item.kind === 'survey')) {
    return 'Call land_workers when the roster is ready.';
  }
  if (!roster.length) {
    return 'Tower roster is empty. Dispatch workers with run_subagent.';
  }
  return 'Review tower_status and recent notifications before the next action.';
}

export async function readTowerStatusPayload(cwd = process.cwd(), {
  inFlight = [],
  pendingWakes = 0,
} = {}) {
  const projectRoot = resolveTowerProjectRoot(cwd);
  const raw = await readTowerStateFile(projectRoot);
  const towerState = normalizeTowerState(raw);
  if (!towerState) {
    return { ok: false, active: false, error: 'Tower mode is not active.' };
  }
  const workers = listTowerWorkersFromState(raw).map(buildTowerWorkerStatusRecord);
  const inFlightIds = [...new Set((Array.isArray(inFlight) ? inFlight : []).map((item) => String(item || '').trim()).filter(Boolean))];
  const running = workers.filter((item) => (
    item.runStatus === 'running' || inFlightIds.includes(item.id)
  )).length;
  const sealed = workers.filter((item) => item.sealed && !item.integrated).length;
  const integrated = workers.filter((item) => item.integrated).length;
  const awaitingReview = workers.filter((item) => (
    item.sealed
    && item.kind !== 'survey'
    && item.reviewPassed !== true
    && item.reviewLoopStopped !== true
    && !item.integrated
  )).length;
  return {
    ok: true,
    active: true,
    fetchedAt: new Date().toISOString(),
    base: towerState.base,
    inFlight: inFlightIds,
    pendingWakes: Number(pendingWakes) || 0,
    counts: {
      roster: workers.length,
      running,
      sealed,
      integrated,
      awaitingReview,
    },
    workers,
    suggestedNext: suggestTowerNextAction({
      workers,
      inFlight: inFlightIds,
      pendingWakes: Number(pendingWakes) || 0,
    }),
  };
}

export function formatTowerStatusSummary(result = {}) {
  if (!result || typeof result !== 'object') return String(result ?? '');
  if (!result.ok) return String(result.error || 'Tower status unavailable.');
  const lines = [
    `Tower base: ${result.base} · fetched ${result.fetchedAt}`,
    `Roster: ${result.counts?.roster ?? 0} · running ${result.counts?.running ?? 0} · sealed ${result.counts?.sealed ?? 0} · integrated ${result.counts?.integrated ?? 0}`,
  ];
  if (result.inFlight?.length) lines.push(`In flight: ${result.inFlight.join(', ')}`);
  if (result.pendingWakes) lines.push(`Pending wakes: ${result.pendingWakes}`);
  if (result.suggestedNext) lines.push(`Next: ${result.suggestedNext}`);
  for (const worker of result.workers || []) {
    const review = worker.reviewPassed === true
      ? 'pass'
      : worker.reviewPassed === false
        ? 'fail'
        : 'pending';
    const parts = [
      worker.id,
      `run=${worker.runStatus || 'idle'}`,
      worker.sealed ? 'sealed' : '',
      worker.integrated ? 'integrated' : '',
      `review=${review}`,
    ].filter(Boolean);
    lines.push(`- ${parts.join(' | ')}`);
  }
  return lines.join('\n');
}

function sealLabel({ dirty, workerKind = '', status = '' } = {}) {
  const kind = String(workerKind || '').trim().toLowerCase();
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'failed') return 'failed';
  if (kind === 'survey') {
    return dirty === true ? 'dirty' : 'survey-complete';
  }
  if (dirty === true) return 'dirty';
  if (dirty === false) return 'sealed';
  return normalized === 'completed' ? 'completed' : 'unknown';
}

export function formatTowerRosterSnapshot(workers = []) {
  const roster = listTowerWorkersFromState({ workers });
  if (!roster.length) return 'Tower roster: (empty)';
  const lines = roster.map((item) => {
    const scope = Array.isArray(item.paths) && item.paths.length ? item.paths.join(', ') : 'no paths';
    const parts = [
      item.id,
      `scope=${scope}`,
      item.integrated === true ? 'integrated' : 'idle',
      item.runStatus ? `run=${item.runStatus}` : '',
      item.dirty === true ? 'dirty' : item.dirty === false ? 'sealed' : '',
      item.reviewPassed === true ? 'review=pass' : item.reviewPassed === false ? 'review=fail' : '',
      item.reviewLoopStopped === true ? 'review-loop-stopped' : '',
      item.rebaseOnto ? `rebaseOnto=${item.rebaseOnto}` : '',
      item.landBase ? `landBase=${item.landBase}` : '',
      item.lastHandoffPath ? `handoff=${item.lastHandoffPath}` : '',
      item.runError ? `error=${item.runError}` : '',
    ].filter(Boolean);
    return `- ${parts.join(' | ')}`;
  });
  return ['Tower roster snapshot:', ...lines].join('\n');
}

export function parseTowerWakeHeadline(wakeText = '') {
  const lines = String(wakeText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const headline = lines.find((line) => !line.startsWith('<') && !line.startsWith('</'));
  return headline || 'Tower notification';
}

export function parseTowerReviewCompletedWake(wakeText = '') {
  const headline = parseTowerWakeHeadline(wakeText);
  const match = String(headline || '').match(/Tower review of "([^"]+)" finished/i);
  return match ? String(match[1] || '').trim() : '';
}

export function buildTowerWorkerCompletedWake({
  workerId = '',
  reviewOf = '',
  status = 'completed',
  dirty,
  workerKind = '',
  summary = '',
  handoffPath = '',
  reviewPassed,
  reviewLoopStopped,
  reviewRound,
} = {}) {
  const id = String(workerId || reviewOf || '').trim();
  const seal = sealLabel({ dirty, workerKind, status });
  const notificationType = String(reviewOf || '').trim()
    ? 'tower.review.completed'
    : 'tower.worker.completed';
  const headline = String(reviewOf || '').trim()
    ? `Tower review of "${reviewOf}" finished (${status}).`
    : `Tower worker "${id}" ${status}.`;
  const reviewLine = String(reviewOf || '').trim()
    ? reviewLoopStopped === true
      ? `Review loop stopped${Number(reviewRound) > 0 ? ` after ${Number(reviewRound)} rounds` : ''}.`
      : reviewPassed === true
        ? 'Review passed. land_workers may include this worker when ready.'
        : reviewPassed === false
          ? `Review did not pass. Resume "${reviewOf}" with the review text.`
          : ''
    : '';
  return [
    `<notification type="${notificationType}" workerId="${id}" status="${status}">`,
    headline,
    `Seal: ${seal}`,
    String(summary || '').trim() ? `Summary: ${String(summary).trim()}` : '',
    String(handoffPath || '').trim() ? `Handoff: ${String(handoffPath).trim()}` : '',
    reviewLine,
    'Worker completion is asynchronous. Call tower_status or use this notification for the latest roster; do not wait on the original run_subagent tool result.',
    '</notification>',
  ].filter(Boolean).join('\n');
}

export function compactTowerSpawnResultForParent({
  workerId = '',
  taskId = '',
  status = 'running',
  branch = '',
  worktreePath = '',
  reviewOf = '',
  role = '',
} = {}) {
  const id = String(workerId || '').trim();
  const reviewed = String(reviewOf || '').trim();
  const lines = [
    reviewed
      ? `Tower review of "${reviewed}" started (${status}).`
      : `Tower worker "${id || role || 'worker'}" spawned (${status}).`,
    String(taskId || '').trim() ? `Task id: ${String(taskId).trim()}.` : '',
    String(branch || '').trim() ? `Branch: ${String(branch).trim()}.` : '',
    String(worktreePath || '').trim() ? `Worktree: ${String(worktreePath).trim()}.` : '',
    'The worker runs in the background; completion wakes the tower in a new turn.',
    id && !reviewed ? `Resume later with resume: "${id}".` : '',
  ].filter(Boolean);
  return lines.join('\n');
}
