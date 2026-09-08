import path from 'node:path';

import {
  listUnreadCrewEvents,
  listCrewWorkersFromState,
  markCrewEventsDelivered,
  normalizeCrewState,
  readCrewStateFile,
} from './crew-store.js';
import {
  buildCrewProgressItems,
  describeCrewWorkerProgress,
  formatCrewProgressLine,
  shouldShowCrewProgressDock,
} from './crew-progress.js';
import {
  parseCrewReviewCompletedWake,
  parseCrewWakeHeadline,
} from './crew-notification.js';

export {
  buildCrewProgressItems,
  describeCrewWorkerProgress,
  formatCrewProgressLine,
  shouldShowCrewProgressDock,
  parseCrewReviewCompletedWake,
  parseCrewWakeHeadline,
};

export function resolveCrewProjectRoot(cwd = process.cwd()) {
  const normalized = path.resolve(cwd).replace(/\\/g, '/');
  const marker = '/.codemini/crew/worktrees/';
  const idx = normalized.indexOf(marker);
  if (idx >= 0) return normalized.slice(0, idx);
  return normalized;
}

export function buildCrewWorkerStatusRecord(worker = {}) {
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

export function suggestCrewNextAction({ workers = [], inFlight = [], pendingWakes = 0 } = {}) {
  const pending = Number(pendingWakes) || 0;
  if (pending > 0) {
    return 'A Crew notification is queued. Do not land or dispatch; wait for that wake turn.';
  }
  const roster = (Array.isArray(workers) ? workers : []).filter((item) => item.integrated !== true);
  const inFlightIds = [...new Set((Array.isArray(inFlight) ? inFlight : []).map((item) => String(item || '').trim()).filter(Boolean))];
  if (inFlightIds.length) {
    return `Wait for in-flight workers (${inFlightIds.join(', ')}) or call crew_status again before dispatching. If the user changed a worker's assignment, cancel_worker that id then run_subagent — do not only explain that workers cannot be interrupted.`;
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
  const needRebase = awaitingReview.filter((item) => String(item.rebaseOnto || '').trim());
  if (needRebase.length) {
    return `Resume and rebase onto the current base: ${needRebase.map((item) => item.id).join(', ')}. Then dispatch reviewer for the new commit.`;
  }
  if (awaitingReview.length) {
    return `Dispatch reviewer for: ${awaitingReview.map((item) => item.id).join(', ')}. If another worker already landed, resume and rebase first, then review.`;
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
    return 'Crew roster is empty. Dispatch workers with run_subagent.';
  }
  return 'Review crew_status and recent notifications before the next action.';
}

export async function readCrewStatusPayload(cwd = process.cwd(), {
  inFlight = [],
  pendingWakes = 0,
} = {}) {
  const projectRoot = resolveCrewProjectRoot(cwd);
  const raw = await readCrewStateFile(projectRoot);
  const crewState = normalizeCrewState(raw);
  if (!crewState) {
    return { ok: false, active: false, error: 'Crew mode is not active.' };
  }
  const workers = listCrewWorkersFromState(raw).map(buildCrewWorkerStatusRecord);
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
  const events = listUnreadCrewEvents(raw);
  if (events.length) {
    await markCrewEventsDelivered(projectRoot, {
      eventIds: events.map((item) => item.id),
    }).catch(() => null);
  }
  return {
    ok: true,
    active: true,
    fetchedAt: new Date().toISOString(),
    base: crewState.base,
    inFlight: inFlightIds,
    pendingWakes: Number(pendingWakes) || 0,
    counts: {
      roster: workers.length,
      running,
      sealed,
      integrated,
      awaitingReview,
      unreadEvents: events.length,
    },
    workers,
    events,
    suggestedNext: suggestCrewNextAction({
      workers,
      inFlight: inFlightIds,
      pendingWakes: Number(pendingWakes) || 0,
    }),
  };
}

export function formatCrewStatusSummary(result = {}) {
  if (!result || typeof result !== 'object') return String(result ?? '');
  if (!result.ok) return String(result.error || 'Crew status unavailable.');
  const lines = [
    `Crew base: ${result.base} · fetched ${result.fetchedAt}`,
    `Roster: ${result.counts?.roster ?? 0} · running ${result.counts?.running ?? 0} · sealed ${result.counts?.sealed ?? 0} · integrated ${result.counts?.integrated ?? 0}`,
  ];
  if (result.inFlight?.length) lines.push(`In flight: ${result.inFlight.join(', ')}`);
  if (result.pendingWakes) lines.push(`Pending wakes: ${result.pendingWakes}`);
  if (result.events?.length) {
    lines.push(`Unread events: ${result.events.length}`);
    for (const event of result.events) {
      const summary = String(event.payload?.summary || '').trim();
      const parts = [
        event.kind,
        event.from,
        event.payload?.status || '',
        summary ? summary.slice(0, 80) : '',
      ].filter(Boolean);
      lines.push(`  - ${parts.join(' | ')}`);
    }
  }
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

export function formatCrewRosterSnapshot(workers = []) {
  const roster = listCrewWorkersFromState({ workers });
  if (!roster.length) return 'Crew roster: (empty)';
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
  return ['Crew roster snapshot:', ...lines].join('\n');
}

export function formatCrewReviewIncompleteGuidance(workerId = '') {
  const id = String(workerId || 'worker').trim() || 'worker';
  return `Review of "${id}" incomplete — not a failed review. Reviewer did not call submit_crew_review. If crew_status shows another worker already landed or the base moved, resume "${id}" and rebase onto the current base, then review the new commit. Otherwise dispatch reviewer again with review: "${id}". Do not land until a passing review is recorded.`;
}

export function buildCrewWorkerCompletedWake({
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
  reviewIncomplete,
} = {}) {
  const id = String(workerId || reviewOf || '').trim();
  const seal = sealLabel({ dirty, workerKind, status });
  const notificationType = String(reviewOf || '').trim()
    ? 'crew.review.completed'
    : 'crew.worker.completed';
  const headline = String(reviewOf || '').trim()
    ? `Crew review of "${reviewOf}" finished (${status}).`
    : `Crew worker "${id}" ${status}.`;
  const reviewLine = String(reviewOf || '').trim()
    ? reviewLoopStopped === true
      ? `Review loop stopped${Number(reviewRound) > 0 ? ` after ${Number(reviewRound)} rounds` : ''}.`
      : reviewIncomplete === true
        ? formatCrewReviewIncompleteGuidance(reviewOf)
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
    'Worker completion is asynchronous. Call crew_status or use this notification for the latest roster; do not wait on the original run_subagent tool result.',
    '</notification>',
  ].filter(Boolean).join('\n');
}

export function compactCrewSpawnResultForParent({
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
      ? `Crew review of "${reviewed}" started (${status}).`
      : `Crew worker "${id || role || 'worker'}" spawned (${status}).`,
    String(taskId || '').trim() ? `Task id: ${String(taskId).trim()}.` : '',
    String(branch || '').trim() ? `Branch: ${String(branch).trim()}.` : '',
    String(worktreePath || '').trim() ? `Worktree: ${String(worktreePath).trim()}.` : '',
    'The worker runs in the background; completion wakes Crew in a new turn.',
    id && !reviewed ? `Resume later with resume: "${id}".` : '',
  ].filter(Boolean);
  return lines.join('\n');
}
