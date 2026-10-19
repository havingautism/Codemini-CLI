import path from 'node:path';

import {
  isCrewTaskTerminal,
  listCrewMissionsFromState,
  listUnreadCrewEvents,
  listUnreadCrewInbox,
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
    ...(worker.name ? { name: worker.name } : {}),
    kind,
    paths: Array.isArray(worker.paths) ? worker.paths : [],
    task: worker.task || '',
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

export function suggestCrewNextAction({
  workers = [],
  missions,
  inFlight = [],
  pendingWakes = 0,
} = {}) {
  const pending = Number(pendingWakes) || 0;
  if (pending > 0) {
    return 'A Crew notification is queued. Do not land or dispatch; wait for that wake turn.';
  }
  const inFlightIds = [...new Set((Array.isArray(inFlight) ? inFlight : []).map((item) => String(item || '').trim()).filter(Boolean))];
  if (inFlightIds.length) {
    return `Wait for in-flight workers (${inFlightIds.join(', ')}) or call crew_status again before dispatching.`;
  }
  const missionList = Array.isArray(missions)
    ? missions
    : (Array.isArray(workers) ? workers : []).filter((worker) => worker.integrated !== true).map((worker) => ({
      id: worker.id,
      kind: worker.kind === 'survey' ? 'survey' : 'build',
      status: worker.sealed || worker.reviewPassed === true ? 'completed' : 'active',
      workerId: worker.id,
      title: worker.id,
    }));
  if (!missionList.length) {
    return 'No missions are recorded. Call crew_plan before dispatching. An empty mission list is not a finished crew.';
  }
  const roster = (Array.isArray(workers) ? workers : []).filter((item) => item.integrated !== true);
  const dirty = roster.filter((item) => item.dirty === true);
  if (dirty.length) {
    return `Resume dirty workers: ${dirty.map((item) => item.id).join(', ')} before review or land.`;
  }
  const planned = missionList.filter((mission) => mission.status === 'planned');
  if (planned.length) {
    return `Dispatch with run_subagent mission_id for: ${planned.map((mission) => mission.id).join(', ')}.`;
  }
  const needRebase = roster.filter((item) => String(item.rebaseOnto || '').trim());
  if (needRebase.length) {
    return `Resume and rebase onto the current base: ${needRebase.map((item) => item.id).join(', ')}. Then dispatch a reviewer for the new commit.`;
  }
  const awaitingReview = missionList.filter((mission) => (
    mission.kind === 'build'
    && mission.status === 'completed'
    && roster.some((worker) => (
      (worker.id === mission.workerId || worker.missionId === mission.id)
      && worker.reviewPassed !== true
      && worker.reviewLoopStopped !== true
    ))
  ));
  if (awaitingReview.length) {
    return `Dispatch a reviewer for: ${awaitingReview.map((mission) => mission.workerId || mission.id).join(', ')}.`;
  }
  const ready = missionList.filter((mission) => (
    mission.kind === 'build'
    && mission.status === 'completed'
    && roster.some((worker) => (
      (worker.id === mission.workerId || worker.missionId === mission.id)
      && worker.reviewPassed === true
    ))
  ));
  if (ready.length) {
    return `Call land_workers for mission ${ready[0].id}.`;
  }
  const sealedAwaiting = roster.filter((worker) => (
    worker.sealed
    && worker.kind !== 'survey'
    && worker.reviewPassed !== true
    && worker.reviewLoopStopped !== true
  ));
  if (sealedAwaiting.length) {
    return `Dispatch reviewer for: ${sealedAwaiting.map((worker) => worker.id).join(', ')}.`;
  }
  if (missionList.every((mission) => isCrewTaskTerminal(mission))) {
    return 'Every mission is terminal. Call crew_finish to remove clean worktrees. Crew mode stays on.';
  }
  return 'Review crew_status before the next action.';
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
  const missions = listCrewMissionsFromState(raw);
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
  const inbox = listUnreadCrewInbox(raw);
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
      unreadInbox: inbox.length,
    },
    workers,
    missions,
    events,
    inbox,
    suggestedNext: suggestCrewNextAction({
      workers,
      missions,
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
  if (result.inbox?.length) {
    lines.push(`Unread inbox: ${result.inbox.length}`);
    for (const message of result.inbox) {
      lines.push(`  - ${message.from} -> ${message.to}${message.subject ? `: ${message.subject}` : ''}`);
    }
  }
  if (result.suggestedNext) lines.push(`Next: ${result.suggestedNext}`);
  for (const mission of result.missions || []) {
    lines.push(`- mission ${mission.id} | ${mission.status} | ${mission.kind} | ${mission.title}`);
  }
  for (const worker of result.workers || []) {
    const review = worker.reviewPassed === true
      ? 'pass'
      : worker.reviewPassed === false
        ? 'fail'
        : 'pending';
    const surveyDone = worker.kind === 'survey'
      && worker.runStatus === 'completed'
      && worker.dirty !== true;
    const parts = [
      worker.name ? `${worker.name} (${worker.id})` : worker.id,
      worker.task ? `task=${worker.task}` : '',
      Array.isArray(worker.paths) && worker.paths.length ? `paths=${worker.paths.join(',')}` : '',
      `run=${worker.runStatus || 'idle'}`,
      surveyDone ? 'survey-complete' : worker.sealed ? 'sealed' : '',
      worker.integrated && !surveyDone ? 'integrated' : '',
      `review=${review}`,
    ].filter(Boolean);
    lines.push(`- ${parts.join(' | ')}`);
  }
  return lines.join('\n');
}

function sealLabel({ dirty, workerKind = '', status = '' } = {}) {
  const kind = String(workerKind || '').trim().toLowerCase();
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'failed' || normalized === 'blocked') return normalized;
  if (normalized === 'awaiting_submit') return 'awaiting_submit';
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
    const surveyDone = String(item.kind || '').toLowerCase() === 'survey'
      && String(item.runStatus || '').toLowerCase() === 'completed'
      && item.dirty !== true;
    const parts = [
      item.name ? `${item.name} (${item.id})` : item.id,
      item.task ? `task=${item.task}` : '',
      `scope=${scope}`,
      surveyDone ? 'survey-complete' : item.integrated === true ? 'integrated' : 'idle',
      item.runStatus ? `run=${item.runStatus}` : '',
      item.dirty === true ? 'dirty' : item.dirty === false && !surveyDone ? 'sealed' : '',
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
  return `Review of "${id}" incomplete — not a failed review. Reviewer did not call submit_crew_review. Dispatch reviewer again with review: "${id}". Do not land until a passing review is recorded.`;
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
  name = '',
} = {}) {
  const id = String(workerId || reviewOf || '').trim();
  const nickname = String(name || '').trim();
  const reviewTarget = String(reviewOf || '').trim();
  const named = nickname && id && nickname !== id ? `${nickname} (${id})` : (nickname || id);
  const seal = sealLabel({ dirty, workerKind, status });
  const normalizedStatus = String(status || 'completed').trim().toLowerCase();
  const notificationType = reviewTarget
    ? 'crew.review.completed'
    : normalizedStatus === 'awaiting_submit'
      ? 'crew.worker.awaiting_submit'
      : normalizedStatus === 'failed' || normalizedStatus === 'blocked'
        ? 'crew.worker.failed'
        : 'crew.worker.completed';
  const headline = reviewTarget
    ? `Crew review of "${reviewTarget}"${nickname ? ` (${nickname})` : ''} finished (${status}).`
    : normalizedStatus === 'awaiting_submit'
      ? `Crew worker "${named || 'worker'}" ended without crew_complete.`
      : `Crew worker "${named || 'worker'}" ${status}.`;
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
    : normalizedStatus === 'awaiting_submit'
      ? `Mission still active. Resume "${id}" and call crew_complete (outcome ok, blocked, or failed) before stopping.`
      : (!reviewTarget && String(workerKind || '').toLowerCase() === 'survey' && normalizedStatus === 'completed')
        ? 'Survey submitted. Do not review or land. Call crew_plan for build missions when ready.'
        : '';
  return [
    `<notification type="${notificationType}" workerId="${id}" status="${status}">`,
    headline,
    `Seal: ${seal}`,
    String(summary || '').trim() ? `Summary: ${String(summary).trim()}` : '',
    String(handoffPath || '').trim() ? `Handoff: ${String(handoffPath).trim()}` : '',
    reviewLine,
    normalizedStatus === 'awaiting_submit'
      ? 'Handoff text is not a submission. Only a successful crew_complete advances the mission.'
      : 'Worker completion is asynchronous. Call crew_status or use this notification for the latest roster; do not wait on the original run_subagent tool result.',
    '</notification>',
  ].filter(Boolean).join('\n');
}

export function compactCrewWorkerTurnResultForParent({
  text = '',
  summary = '',
  handoffPath = '',
  workerId = '',
  missionSubmitted = false,
  submitHint = '',
  maxChars = 1500,
} = {}) {
  const body = String(text || '').trim();
  const clipped = body.length <= maxChars ? body : `${body.slice(0, maxChars).trimEnd()}\n\n[truncated]`;
  const id = String(workerId || '').trim();
  if (missionSubmitted) {
    return [
      'Crew worker submitted via crew_complete. Use the crew notification (or crew_status), not this handoff, for review/land.',
      String(summary || '').trim() ? `Summary: ${String(summary).trim()}` : '',
      clipped || '(empty)',
    ].filter(Boolean).join('\n');
  }
  return [
    'Crew worker turn ended without crew_complete. Mission stays active.',
    String(submitHint || '').trim() ? String(submitHint).trim() : '',
    String(summary || '').trim() ? `Summary: ${String(summary).trim()}` : '',
    clipped || '(empty)',
    id ? `Resume with resume: "${id}" and require crew_complete before the worker stops.` : '',
    String(handoffPath || '').trim() ? `Handoff (reference only): ${String(handoffPath).trim()}` : '',
  ].filter(Boolean).join('\n');
}

export function compactCrewSpawnResultForParent({
  workerId = '',
  name = '',
  taskId = '',
  status = 'running',
  branch = '',
  worktreePath = '',
  reviewOf = '',
  role = '',
} = {}) {
  const id = String(workerId || '').trim();
  const nickname = String(name || '').trim();
  const reviewed = String(reviewOf || '').trim();
  const label = nickname && id ? `${nickname} (${id})` : (id || nickname || role || 'worker');
  const lines = [
    reviewed
      ? `Crew review of "${nickname || reviewed}" (${reviewed}) started (${status}).`
      : `Crew worker "${label}" spawned (${status}).`,
    String(taskId || '').trim() ? `Task id: ${String(taskId).trim()}.` : '',
    String(branch || '').trim() ? `Branch: ${String(branch).trim()}.` : '',
    String(worktreePath || '').trim() ? `Worktree: ${String(worktreePath).trim()}.` : '',
    'The worker runs in the background; completion wakes Crew in a new turn.',
    id && !reviewed ? `Resume later with resume: "${id}".` : '',
  ].filter(Boolean);
  return lines.join('\n');
}
