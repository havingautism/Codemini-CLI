import { crewGlobsOverlap, normalizeCrewDependsOn, normalizeCrewPaths } from './crew-scope.js';
import {
  findCrewMissionForWorker,
  isCrewTaskTerminal,
  isWholeRepoCrewGlob,
  listCrewMissionsFromState,
  listCrewWorkersFromState,
  listUnreadCrewInbox,
  normalizeCrewMissionRecord,
  patchCrewWorkerRecord,
  readCrewStateFile,
  updateCrewState,
  writeCrewStateFile,
} from './crew-store.js';
import {
  deleteCrewWorkerBranch,
  isCrewWorktreeDirty,
  listCrewChangedFiles,
  removeCrewWorktree,
} from './crew-worktree.js';

export {
  findCrewMissionForWorker,
  isCrewTaskTerminal,
  isWholeRepoCrewGlob,
  listCrewMissionsFromState,
};

function nextMissionId(missions) {
  let max = 0;
  for (const mission of missions) {
    const match = /^m(\d+)$/.exec(String(mission?.id || ''));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `m${max + 1}`;
}

function scopesOverlap(left, right) {
  const a = normalizeCrewPaths(left);
  const b = normalizeCrewPaths(right);
  for (const glob of a) {
    for (const other of b) {
      if (crewGlobsOverlap(glob, other)) return { glob, other };
    }
  }
  return null;
}

function dependencyLinks(leftId, rightId, byId) {
  const seen = new Set();
  const visit = (id, target) => {
    if (seen.has(id)) return false;
    seen.add(id);
    const mission = byId.get(id);
    if (!mission) return false;
    for (const dep of normalizeCrewDependsOn(mission.dependsOn)) {
      if (dep === target || visit(dep, target)) return true;
    }
    return false;
  };
  return visit(leftId, rightId) || visit(rightId, leftId);
}

export function formatCrewMissionBrief(mission) {
  if (!mission) return '';
  const paths = Array.isArray(mission.paths) && mission.paths.length
    ? mission.paths.join(', ')
    : '(none)';
  const deps = Array.isArray(mission.dependsOn) && mission.dependsOn.length
    ? mission.dependsOn.join(', ')
    : '(none)';
  return [
    `Crew mission ${mission.id}: ${mission.title}`,
    `Kind: ${mission.kind}. Paths: ${paths}. Depends on: ${deps}.`,
    mission.context ? `User context: ${mission.context}` : '',
  ].filter(Boolean).join('\n');
}

export function formatOpenMissionHint(missions = []) {
  const open = (Array.isArray(missions) ? missions : []).filter((mission) => !isCrewTaskTerminal(mission));
  if (!open.length) return 'Every mission is terminal. Call crew_finish to remove clean worktrees. Crew mode stays on.';
  const planned = open.filter((mission) => mission.status === 'planned').map((mission) => mission.id);
  if (planned.length) {
    return `Dispatch with run_subagent mission_id for: ${planned.join(', ')}.`;
  }
  return `Open missions remain: ${open.map((mission) => `${mission.id} (${mission.status})`).join(', ')}.`;
}

export async function planCrewMissions(cwd, { missions = [], abandonId = '' } = {}) {
  const created = [];
  let message = '';
  const result = await updateCrewState(cwd, async (current) => {
    let roster = listCrewMissionsFromState(current);
    const abandon = String(abandonId || '').trim();
    if (abandon) {
      const target = roster.find((mission) => mission.id === abandon);
      if (!target) {
        message = `Unknown mission "${abandon}". Call crew_status for mission ids.`;
        return null;
      }
      if (target.status === 'merged') {
        message = `Mission ${abandon} is merged. land_workers is the only way to record merged.`;
        return null;
      }
      roster = roster.map((mission) => (
        mission.id === abandon ? { ...mission, status: 'abandoned' } : mission
      ));
    }
    const requested = Array.isArray(missions) ? missions : [];
    const batch = [];
    for (const item of requested) {
      const title = String(item?.title || '').replace(/\s+/g, ' ').trim();
      if (!title) {
        message = 'crew_plan missions need a title.';
        return null;
      }
      const kind = String(item?.kind || 'build').trim().toLowerCase() === 'survey' ? 'survey' : 'build';
      const paths = normalizeCrewPaths(item?.paths);
      if (kind === 'build' && (paths.length === 0 || paths.some(isWholeRepoCrewGlob))) {
        message = `Build mission "${title}" needs narrow relative paths. Whole-repo globs are rejected.`;
        return null;
      }
      const id = nextMissionId([...roster, ...batch]);
      const dependsOn = normalizeCrewDependsOn(item?.depends_on || item?.dependsOn);
      const known = new Set([...roster, ...batch].map((mission) => mission.id));
      for (const dep of dependsOn) {
        if (!known.has(dep)) {
          message = `Mission "${title}" depends on unknown mission "${dep}".`;
          return null;
        }
      }
      batch.push(normalizeCrewMissionRecord({
        id,
        title,
        kind,
        status: 'planned',
        paths,
        dependsOn,
        context: item?.context,
      }));
    }
    if (!abandon && batch.length === 0) {
      message = 'crew_plan needs at least one mission, or abandon set to a mission id.';
      return null;
    }
    const byId = new Map([...roster, ...batch].map((mission) => [mission.id, mission]));
    const openBuilds = [...roster, ...batch].filter((mission) => (
      mission.kind === 'build' && !isCrewTaskTerminal(mission) && mission.status !== 'completed'
    ));
    for (let i = 0; i < openBuilds.length; i += 1) {
      for (let j = i + 1; j < openBuilds.length; j += 1) {
        const overlap = scopesOverlap(openBuilds[i].paths, openBuilds[j].paths);
        if (!overlap) continue;
        if (dependencyLinks(openBuilds[i].id, openBuilds[j].id, byId)) continue;
        message = `Mission scopes overlap: ${openBuilds[i].id} ("${overlap.glob}") vs ${openBuilds[j].id} ("${overlap.other}") without a dependency. Split the files or set depends_on.`;
        return null;
      }
    }
    created.push(...batch);
    const next = [...roster, ...batch];
    const lines = [];
    if (abandon) lines.push(`Mission ${abandon} abandoned.`);
    if (batch.length) {
      lines.push(`Planned ${batch.map((mission) => `${mission.id} (${mission.title})`).join(', ')}.`);
      lines.push(`Next: ${formatOpenMissionHint(next)}`);
    }
    message = lines.join(' ');
    return { missions: next };
  });
  if (message.includes('overlap') || message.startsWith('Unknown') || message.startsWith('Build') || message.startsWith('crew_plan') || message.includes('depends on unknown') || (message.startsWith('Mission') && message.includes('is merged'))) {
    return { ok: false, code: message.includes('overlap') ? 'SCOPE_OVERLAP' : 'PLAN_REJECTED', error: message };
  }
  return { ok: true, missions: listCrewMissionsFromState(result), created, message };
}

export function crewMissionAcceptsSpawn(mission, { resume = false, rebaseOnto = '' } = {}) {
  if (!mission) {
    return {
      ok: false,
      code: 'UNKNOWN_MISSION',
      error: 'Unknown mission_id. Call crew_plan, then pass that id to run_subagent.',
    };
  }
  const status = mission.status;
  const needsRebase = Boolean(String(rebaseOnto || '').trim());
  if (status === 'merged' || status === 'abandoned' || (mission.kind === 'survey' && status === 'completed')) {
    return {
      ok: false,
      code: 'MISSION_TERMINAL',
      error: `Mission ${mission.id} is ${status}. Do not spawn another worker on it. ${formatOpenMissionHint([])}`,
    };
  }
  if (mission.kind === 'build' && status === 'completed' && needsRebase && resume) {
    return { ok: true };
  }
  if (mission.kind === 'build' && status === 'completed' && !resume) {
    return {
      ok: false,
      code: 'MISSION_COMPLETED',
      error: `Mission ${mission.id} is completed. Dispatch a reviewer with review set to its worker, then land_workers for ${mission.id}.`,
    };
  }
  if (mission.kind === 'build' && status === 'completed' && resume) {
    return {
      ok: false,
      code: 'MISSION_COMPLETED',
      error: `Mission ${mission.id} is completed. Review it, or wait for a failed review to return it to active before resume.`,
    };
  }
  return { ok: true };
}

export async function bindCrewMissionWorker(cwd, missionId, workerId) {
  const current = (await readCrewStateFile(cwd)) || {};
  const missions = listCrewMissionsFromState(current);
  const id = String(missionId || '').trim();
  const next = missions.map((mission) => (
    mission.id === id
      ? { ...mission, status: 'active', workerId: String(workerId || '').trim() }
      : mission
  ));
  await writeCrewStateFile(cwd, { missions: next });
  return next.find((mission) => mission.id === id) || null;
}

export async function setCrewMissionStatus(cwd, missionId, status) {
  const current = (await readCrewStateFile(cwd)) || {};
  const missions = listCrewMissionsFromState(current);
  const id = String(missionId || '').trim();
  const allowed = new Set(['planned', 'active', 'completed', 'merged', 'abandoned']);
  const statusName = allowed.has(status) ? status : '';
  if (!id || !statusName) return null;
  const next = missions.map((mission) => (
    mission.id === id ? { ...mission, status: statusName } : mission
  ));
  await writeCrewStateFile(cwd, { missions: next });
  return next.find((mission) => mission.id === id) || null;
}

function normalizeCrewCompleteOutcome(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'blocked' || raw === 'failed') return raw;
  return 'ok';
}

export async function completeCrewMission({ cwd, workerId, report = '', outcome = 'ok' } = {}) {
  const text = String(report || '').trim();
  if (!text) {
    return { ok: false, code: 'REPORT_REQUIRED', error: 'crew_complete requires a report.' };
  }
  const submissionOutcome = normalizeCrewCompleteOutcome(outcome);
  const root = cwd;
  const state = (await readCrewStateFile(root)) || {};
  const workers = listCrewWorkersFromState(state);
  const worker = workers.find((item) => item.id === String(workerId || '').trim());
  if (!worker) {
    return { ok: false, code: 'NOT_WORKER', error: 'crew_complete is only for the worker that owns a mission.' };
  }
  const missions = listCrewMissionsFromState(state);
  const mission = findCrewMissionForWorker(missions, worker);
  if (!mission) {
    return { ok: false, code: 'UNKNOWN_MISSION', error: `Worker "${worker.id}" has no mission. Dispatch with mission_id from crew_plan.` };
  }
  const unread = listUnreadCrewInbox(state, { to: worker.id });
  if (unread.length) {
    return {
      ok: false,
      code: 'UNREAD_INBOX',
      error: `Mission ${mission.id} cannot be completed — ${unread.length} unread inbox message(s). Call crew_inbox, then retry crew_complete.`,
    };
  }
  const dirty = await isCrewWorktreeDirty(worker.worktreePath).catch(() => true);
  if (submissionOutcome === 'ok' && dirty) {
    return {
      ok: false,
      code: 'DIRTY',
      error: mission.kind === 'survey'
        ? `Mission ${mission.id} cannot be completed — the survey worktree is dirty. Revert edits. Do not commit.`
        : `Mission ${mission.id} cannot be completed — the worktree is dirty. Commit the source changes, then retry crew_complete.`,
    };
  }
  const changed = await listCrewChangedFiles(root, state.base, worker.branch);
  if (submissionOutcome === 'ok' && mission.kind === 'survey' && changed.length) {
    return {
      ok: false,
      code: 'SURVEY_DIFF',
      error: `Mission ${mission.id} cannot be completed — survey branch changed ${changed.slice(0, 5).join(', ')}. Revert those files.`,
    };
  }
  if (submissionOutcome === 'ok' && mission.kind !== 'survey' && !changed.length) {
    return {
      ok: false,
      code: 'NO_DIFF',
      error: `Mission ${mission.id} cannot be completed — branch has no changes against the base. Commit the work, use outcome blocked/failed if you cannot, or abandon the mission.`,
    };
  }
  const workerPatch = {
    runStatus: 'completed',
    dirty: dirty === true,
    runError: submissionOutcome === 'ok' ? '' : text.slice(0, 400),
  };
  await patchCrewWorkerRecord(root, worker.id, workerPatch).catch(() => null);
  let next = missions;
  if (submissionOutcome === 'ok') {
    next = missions.map((item) => (
      item.id === mission.id ? { ...item, status: 'completed', report: text.slice(0, 4000), outcome: 'ok' } : item
    ));
    await writeCrewStateFile(root, { missions: next });
    await patchCrewWorkerRecord(root, worker.id, { missionId: mission.id }).catch(() => null);
  }
  const updated = next.find((item) => item.id === mission.id);
  const wakeStatus = submissionOutcome === 'ok' ? 'completed' : submissionOutcome;
  return {
    ok: true,
    outcome: submissionOutcome,
    mission: updated,
    workerId: worker.id,
    workerName: String(worker.name || '').trim(),
    workerKind: mission.kind === 'survey' ? 'survey' : '',
    dirty: dirty === true,
    report: text.slice(0, 4000),
    wakeStatus,
    message: submissionOutcome === 'ok'
      ? (mission.kind === 'survey'
        ? `Mission ${mission.id} completed (survey). It is not merged. ${formatOpenMissionHint(next)}`
        : `Mission ${mission.id} submitted. Next: dispatch a reviewer with review set to ${worker.id}, then land_workers for ${mission.id}.`)
      : `Mission ${mission.id} stays active (${submissionOutcome}). Coordinator: read the report, then resume or abandon.`,
  };
}

export async function reopenCrewMission(cwd, workerId) {
  const state = (await readCrewStateFile(cwd)) || {};
  const workers = listCrewWorkersFromState(state);
  const worker = workers.find((item) => item.id === String(workerId || '').trim());
  if (!worker) return null;
  const missions = listCrewMissionsFromState(state);
  const mission = findCrewMissionForWorker(missions, worker);
  if (!mission || mission.status !== 'completed') return mission;
  return setCrewMissionStatus(cwd, mission.id, 'active');
}

export async function finishCrewMissions({ cwd, inFlight = [] } = {}) {
  const flying = [...new Set((Array.isArray(inFlight) ? inFlight : []).map((item) => String(item || '').trim()).filter(Boolean))];
  if (flying.length) {
    return {
      ok: false,
      code: 'WORKERS_IN_FLIGHT',
      error: `crew_finish refused — workers still running: ${flying.join(', ')}. Wait, then retry.`,
    };
  }
  const state = (await readCrewStateFile(cwd)) || {};
  const missions = listCrewMissionsFromState(state);
  if (!missions.length) {
    return {
      ok: false,
      code: 'NO_MISSIONS',
      error: 'crew_finish refused — the mission list is empty. An empty list is not a finished crew. Call crew_plan.',
    };
  }
  const unfinished = missions.filter((mission) => !isCrewTaskTerminal(mission));
  if (unfinished.length) {
    return {
      ok: false,
      code: 'MISSIONS_OPEN',
      error: `crew_finish refused — not terminal: ${unfinished.map((mission) => `${mission.id} (${mission.status})`).join(', ')}. Build missions must be merged with land_workers or abandoned; surveys must be completed or abandoned.`,
    };
  }
  const workers = listCrewWorkersFromState(state);
  const removed = [];
  const branchesRemoved = [];
  const kept = [];
  for (const mission of missions) {
    const worker = workers.find((item) => item.id === mission.workerId || item.missionId === mission.id);
    if (!worker) continue;
    const result = await removeCrewWorktree({ cwd, worker, force: false });
    if (result.ok && (result.removed || result.missing)) {
      removed.push(mission.id);
      if (await deleteCrewWorkerBranch(cwd, worker)) {
        branchesRemoved.push(String(worker.branch || worker.id).trim());
      }
    } else {
      kept.push(`${mission.id}${result.dirty ? ' (dirty)' : ''}`);
    }
  }
  return {
    ok: true,
    removed,
    branchesRemoved,
    kept,
    message: [
      'Crew finish removed clean worktrees and worker branches. Records stay. Crew mode stays on.',
      removed.length ? `Worktrees removed: ${removed.join(', ')}.` : 'No worktrees removed.',
      branchesRemoved.length ? `Branches deleted: ${branchesRemoved.join(', ')}.` : '',
      kept.length ? `Kept: ${kept.join(', ')}.` : '',
      'A later request can call crew_plan again.',
    ].filter(Boolean).join(' '),
  };
}
