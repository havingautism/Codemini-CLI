import path from 'node:path';

import { getProjectCrewWorktreesDir } from './paths.js';
import { runGit } from './process-run.js';
import { fileMatchesCrewPaths, isCrewLandableWorker } from './crew-scope.js';
import {
  formatCrewReviewLoopStoppedError,
  listCrewWorkersFromState,
  patchCrewWorkerRecord,
  readCrewStateFile,
  workerLandBaseRef,
  workerReviewMatchesCommit,
} from './crew-store.js';
import {
  isCrewCommitAncestor,
  isCrewWorktreeDirty,
  withCrewGitLock,
} from './crew-worktree.js';

const LEGACY_TMP_BRANCH = 'codemini-crew/_merge-tmp';
const LEGACY_TMP_WORKTREE_ID = '_merge-tmp';
const GIT_TIMEOUT_MS = 60_000;
const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'Codemini Crew',
  GIT_AUTHOR_EMAIL: 'crew@codemini.local',
  GIT_COMMITTER_NAME: 'Codemini Crew',
  GIT_COMMITTER_EMAIL: 'crew@codemini.local',
};

async function tryGit(cwd, args) {
  return runGit(args, {
    cwd,
    allowFailure: true,
    timeoutMs: GIT_TIMEOUT_MS,
    env: {
      ...process.env,
      ...GIT_IDENTITY,
    },
  });
}

function splitNames(stdout) {
  return String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\/g, '/'))
    .filter(Boolean);
}

async function abortMerge(cwd) {
  await tryGit(cwd, ['merge', '--abort']);
}

async function removeLegacyMergeTmp(root) {
  const worktreePath = path.resolve(getProjectCrewWorktreesDir(root), LEGACY_TMP_WORKTREE_ID);
  await tryGit(root, ['worktree', 'remove', '--force', worktreePath]);
  await tryGit(root, ['branch', '-D', LEGACY_TMP_BRANCH]);
  await tryGit(root, ['worktree', 'prune']);
}

export function buildLandMergeConflict(worker, files = [], { missionId = '' } = {}) {
  const names = Array.isArray(files) ? files.filter(Boolean) : [];
  const mission = String(missionId || worker?.missionId || '').trim();
  return {
    ok: false,
    code: 'LAND_MERGE_CONFLICT',
    error: mission
      ? `Mission ${mission} already contains the current base tip, but git merge still failed. Do not call crew_rebase — the worker branch is not behind base. Check git status on the main checkout: uncommitted files often block merge (commit, stash, or remove them and ask the user if needed). Do not resume the worker for main-checkout-only issues; retry land_workers after the main worktree is clean.`
      : `Worker "${worker.id}" already contains the current base tip, but git merge still failed. Check the main checkout worktree before resuming the worker.`,
    workerId: worker.id,
    missionId: mission || undefined,
    ...(names.length ? { files: names } : {}),
  };
}

export function buildMainWorktreeDirty(worker, { missionId = '' } = {}) {
  const mission = String(missionId || worker?.missionId || '').trim();
  return {
    ok: false,
    code: 'MAIN_WORKTREE_DIRTY',
    error: mission
      ? `Mission ${mission} cannot land while the main checkout has uncommitted changes. Ask the user to commit, stash, or remove local edits on the base branch, then retry land_workers. Do not resume the worker to fix this.`
      : `Cannot land while the main checkout has uncommitted changes. Ask the user to clean up the base branch worktree, then retry land_workers.`,
    workerId: worker.id,
    missionId: mission || undefined,
  };
}

function buildRebaseRequired(worker, files = [], { missionId = '', onto: ontoOverride = '' } = {}) {
  const onto = String(ontoOverride || worker?.rebaseOnto || '').trim();
  const names = Array.isArray(files) ? files.filter(Boolean) : [];
  const mission = String(missionId || worker?.missionId || '').trim();
  return {
    ok: false,
    code: 'REBASE_REQUIRED',
    error: mission
      ? `Mission ${mission} is behind the current base tip. Call crew_rebase with mission_id "${mission}" first. If crew_rebase returns RESUME_REQUIRED, resume "${worker.id}" to fix conflicts, then review before land_workers.`
      : `Worker "${worker.id}" is behind the current base tip. Call crew_rebase for that mission first. If crew_rebase returns RESUME_REQUIRED, resume "${worker.id}" to resolve conflicts.`,
    workerId: worker.id,
    missionId: mission || undefined,
    onto,
    ...(names.length ? { files: names } : {}),
  };
}

async function collectScopeEscape(root, base, worker) {
  const against = workerLandBaseRef(worker, base);
  const mergeBase = await tryGit(root, ['merge-base', String(against), worker.branch]);
  const baseSha = String(mergeBase.stdout || '').trim();
  if (mergeBase.code !== 0 || !baseSha) {
    return {
      ok: false,
      code: 'SCOPE_CHECK_FAILED',
      error: String(mergeBase.stderr || mergeBase.stdout || '').trim() || `Failed to find merge-base for ${worker.id}.`,
      workerId: worker.id,
    };
  }
  const diff = await tryGit(root, ['diff', '--name-only', baseSha, worker.branch]);
  if (diff.code !== 0) {
    return {
      ok: false,
      code: 'SCOPE_CHECK_FAILED',
      error: String(diff.stderr || diff.stdout || '').trim() || `Failed to diff ${worker.id} against base.`,
      workerId: worker.id,
    };
  }
  const files = splitNames(diff.stdout);
  const escaped = files.filter((file) => !fileMatchesCrewPaths(file, worker.paths));
  if (escaped.length) {
    return {
      ok: false,
      code: 'SCOPE_ESCAPE',
      error: `Worker "${worker.id}" changed files outside paths: ${escaped.join(', ')}.`,
      workerId: worker.id,
      files: escaped,
    };
  }
  return { ok: true, files };
}

async function classifyWorker(root, baseBranch, worker) {
  if (await isCrewWorktreeDirty(worker.worktreePath)) {
    return {
      kind: 'blocked',
      code: 'DIRTY_WORKTREE',
      error: `Worker worktree still dirty (not sealed): ${worker.id}. Do not land until that worker git commits.`,
      workerId: worker.id,
      workers: [worker.id],
      worker,
    };
  }
  const scope = await collectScopeEscape(root, baseBranch, worker);
  if (!scope.ok) return { kind: 'blocked', ...scope, worker };
  const tip = await tryGit(root, ['rev-parse', worker.branch]);
  const commit = String(tip.stdout || '').trim();
  if (tip.code !== 0 || !commit) {
    return {
      kind: 'blocked',
      code: 'REVIEW_COMMIT_MISSING',
      error: `Could not read the current commit for worker "${worker.id}".`,
      workerId: worker.id,
      worker,
    };
  }
  if (!workerReviewMatchesCommit(worker, commit)) {
    const sameCommit = String(worker.reviewedCommit || '').trim() === commit;
    const failedReview = worker.reviewPassed === false && sameCommit;
    const loopStopped = failedReview && worker.reviewLoopStopped === true;
    return {
      kind: 'blocked',
      code: failedReview ? 'REVIEW_FAILED' : 'REVIEW_REQUIRED',
      error: loopStopped
        ? formatCrewReviewLoopStoppedError(worker)
        : failedReview
          ? `Worker "${worker.id}" review did not pass. Resume "${worker.id}" with the review text, then review the new commit.`
          : `Worker "${worker.id}" has no passing review for the current commit. Call run_subagent with role: "reviewer" and review: "${worker.id}".`,
      workerId: worker.id,
      worker,
    };
  }
  return { kind: 'ready', worker };
}

async function mergeWorkerOntoBase(root, worker, { missionId = '' } = {}) {
  if (await isCrewWorktreeDirty(root)) {
    return buildMainWorktreeDirty(worker, { missionId });
  }
  if (await isCrewCommitAncestor(root, worker.branch)) {
    const head = String((await tryGit(root, ['rev-parse', 'HEAD'])).stdout || '').trim();
    await patchCrewWorkerRecord(root, worker.id, {
      landBase: head,
      rebaseOnto: '',
    }).catch(() => null);
    worker.landBase = head;
    worker.rebaseOnto = '';
    return { ok: true, alreadyMerged: true };
  }
  const merged = await tryGit(root, [
    'merge',
    '--no-ff',
    '-m',
    `codemini-crew merge ${worker.id}`,
    worker.branch,
  ]);
  if (merged.code !== 0) {
    const conflicted = splitNames((await tryGit(root, ['diff', '--name-only', '--diff-filter=U'])).stdout);
    await abortMerge(root);
    if (conflicted.length > 0) {
      return buildLandMergeConflict(worker, conflicted, { missionId: missionId || worker.missionId });
    }
    if (await isCrewWorktreeDirty(root)) {
      return buildMainWorktreeDirty(worker, { missionId: missionId || worker.missionId });
    }
    const mergeDetail = String(merged.stderr || merged.stdout || '').trim();
    const localOverwrite = /local changes|would be overwritten/i.test(mergeDetail);
    return {
      ok: false,
      code: localOverwrite ? 'MAIN_WORKTREE_DIRTY' : 'GIT_MERGE',
      error: localOverwrite
        ? buildMainWorktreeDirty(worker, { missionId: missionId || worker.missionId }).error
        : mergeDetail || `Failed to merge worker "${worker.id}".`,
      workerId: worker.id,
    };
  }
  const head = String((await tryGit(root, ['rev-parse', 'HEAD'])).stdout || '').trim();
  worker.landBase = head;
  worker.rebaseOnto = '';
  await patchCrewWorkerRecord(root, worker.id, {
    landBase: head,
    rebaseOnto: '',
  }).catch(() => null);
  return { ok: true, alreadyMerged: false };
}

export async function landCrewWorkers({
  cwd = process.cwd(),
  base,
  missionId = '',
} = {}) {
  const root = path.resolve(cwd);
  const baseBranch = String(base || '').trim();
  const requestedMission = String(missionId || '').trim();
  if (!requestedMission) {
    return {
      ok: false,
      code: 'MISSION_REQUIRED',
      error: 'land_workers requires mission_id from crew_plan. Pass the completed mission id to merge one build at a time.',
    };
  }
  if (!baseBranch || baseBranch === 'HEAD') {
    return { ok: false, code: 'NO_BASE', error: 'Crew land needs a recorded git base branch.' };
  }
  return withCrewGitLock(root, async () => {
    const { listCrewMissionsFromState, isCrewTaskTerminal, formatOpenMissionHint, setCrewMissionStatus } = await import('./crew-missions.js');
    const currentBranchResult = await tryGit(root, ['branch', '--show-current']);
    const currentBranch = String(currentBranchResult.stdout || '').trim();
    if (currentBranchResult.code !== 0 || currentBranch !== baseBranch) {
      return {
        ok: false,
        code: 'BASE_BRANCH_MISMATCH',
        error: currentBranch
          ? `Crew started on "${baseBranch}", but the current branch is "${currentBranch}". Switch back before landing.`
          : `Crew started on "${baseBranch}", but the current checkout is detached. Switch back before landing.`,
        base: baseBranch,
        currentBranch,
      };
    }
    await removeLegacyMergeTmp(root).catch(() => null);
    const state = await readCrewStateFile(root);
    const missions = listCrewMissionsFromState(state);
    const mission = missions.find((item) => item.id === requestedMission);
    if (!mission) {
      return {
        ok: false,
        code: 'UNKNOWN_MISSION',
        error: `Unknown mission "${requestedMission}". ${formatOpenMissionHint(missions)}`,
      };
    }
    if (mission.kind === 'survey') {
      return {
        ok: false,
        code: 'SURVEY_NO_LAND',
        error: `Mission ${mission.id} is a survey. Surveys are not merged. ${formatOpenMissionHint(missions)}`,
      };
    }
    if (mission.status === 'merged') {
      return {
        ok: true,
        alreadyMerged: true,
        message: `Mission ${mission.id} is already merged. ${formatOpenMissionHint(missions)}`,
      };
    }
    if (mission.status !== 'completed') {
      return {
        ok: false,
        code: 'NOT_COMPLETED',
        error: `Mission ${mission.id} is ${mission.status}. Only a completed build mission can be landed. ${formatOpenMissionHint(missions)}`,
      };
    }
    if (String(mission.outcome || 'ok').trim().toLowerCase() !== 'ok') {
      return {
        ok: false,
        code: 'NOT_SUBMITTED',
        error: `Mission ${mission.id} was not submitted successfully (outcome ${mission.outcome}). Resume or abandon before landing.`,
      };
    }
    const unmet = (mission.dependsOn || []).filter((dep) => {
      const other = missions.find((item) => item.id === dep);
      return other && !isCrewTaskTerminal(other);
    });
    if (unmet.length) {
      return {
        ok: false,
        code: 'DEPS_UNMERGED',
        error: `Mission ${mission.id} depends on ${unmet.join(', ')}, which are not terminal. Land or abandon those first.`,
      };
    }
    const workers = listCrewWorkersFromState(state).filter(isCrewLandableWorker);
    const worker = workers.find((item) => item.id === mission.workerId || item.missionId === mission.id);
    if (!worker) {
      return {
        ok: false,
        code: 'NO_WORKER',
        error: `Mission ${mission.id} has no build worker to land.`,
      };
    }
    const baseHead = String((await tryGit(root, ['rev-parse', 'HEAD'])).stdout || '').trim();
  const containsBase = await isCrewCommitAncestor(root, baseHead, worker.branch);
    if (!containsBase) {
      await patchCrewWorkerRecord(root, worker.id, { rebaseOnto: baseHead }).catch(() => null);
      worker.rebaseOnto = baseHead;
      return buildRebaseRequired(worker, [], { missionId: mission.id, onto: baseHead });
    }
    const classified = await classifyWorker(root, baseBranch, worker);
    if (classified.kind !== 'ready') {
      const { kind, worker: ignored, ...error } = classified;
      return { ok: false, ...error };
    }
    const merged = await mergeWorkerOntoBase(root, worker, { missionId: mission.id });
    if (!merged.ok) return merged;
    await setCrewMissionStatus(root, mission.id, 'merged');
    const after = listCrewMissionsFromState(await readCrewStateFile(root));
    const commitSha = String((await tryGit(root, ['rev-parse', 'HEAD'])).stdout || '').trim();
    return {
      ok: true,
      committed: true,
      commit: commitSha,
      landed: [worker.id],
      missionId: mission.id,
      message: `Merged mission ${mission.id} (${worker.id}) onto ${baseBranch} (tip ${commitSha.slice(0, 12)}). The user still controls push. ${formatOpenMissionHint(after)}`,
    };
  });
}
