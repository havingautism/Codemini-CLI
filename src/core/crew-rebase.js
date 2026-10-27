import path from 'node:path';

import { isCrewLandableWorker, normalizeCrewPaths } from './crew-scope.js';
import {
  listCrewWorkersFromState,
  patchCrewWorkerRecord,
  readCrewStateFile,
  workerReviewMatchesCommit,
} from './crew-store.js';
import {
  isCrewCommitAncestor,
  isCrewWorktreeDirty,
  withCrewGitLock,
} from './crew-worktree.js';
import { runGit } from './process-run.js';

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

async function abortRebase(cwd) {
  await tryGit(cwd, ['rebase', '--abort']);
}

async function treesMatch(root, left, right) {
  const diff = await tryGit(root, ['diff', '--quiet', left, right]);
  return diff.code === 0;
}

async function workerDeliverablesUnchanged(root, left, right, paths) {
  const pathspecs = normalizeCrewPaths(paths);
  if (!pathspecs.length) {
    return treesMatch(root, left, right);
  }
  const diff = await tryGit(root, ['diff', '--quiet', left, right, '--', ...pathspecs]);
  return diff.code === 0;
}

export async function rebaseCrewMission({
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
      error: 'crew_rebase requires mission_id from crew_plan or crew_status.',
    };
  }
  if (!baseBranch || baseBranch === 'HEAD') {
    return { ok: false, code: 'NO_BASE', error: 'Crew rebase needs a recorded git base branch.' };
  }

  return withCrewGitLock(root, async () => {
    const { listCrewMissionsFromState, formatOpenMissionHint } = await import('./crew-missions.js');
    const currentBranchResult = await tryGit(root, ['branch', '--show-current']);
    const currentBranch = String(currentBranchResult.stdout || '').trim();
    if (currentBranchResult.code !== 0 || currentBranch !== baseBranch) {
      return {
        ok: false,
        code: 'BASE_BRANCH_MISMATCH',
        error: currentBranch
          ? `Crew started on "${baseBranch}", but the current branch is "${currentBranch}". Switch back before rebasing.`
          : `Crew started on "${baseBranch}", but the current checkout is detached. Switch back before rebasing.`,
        base: baseBranch,
        currentBranch,
      };
    }

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
        code: 'SURVEY_NO_REBASE',
        error: `Mission ${mission.id} is a survey. Surveys are not rebased for land.`,
      };
    }
    if (mission.status === 'merged') {
      return {
        ok: false,
        code: 'MISSION_MERGED',
        error: `Mission ${mission.id} is already merged.`,
      };
    }
    if (mission.status !== 'completed') {
      return {
        ok: false,
        code: 'NOT_COMPLETED',
        error: `Mission ${mission.id} is ${mission.status}. crew_rebase is only for a completed build mission (usually after land_workers returns REBASE_REQUIRED).`,
      };
    }

    const workers = listCrewWorkersFromState(state).filter(isCrewLandableWorker);
    const worker = workers.find((item) => item.id === mission.workerId || item.missionId === mission.id);
    if (!worker) {
      return {
        ok: false,
        code: 'NO_WORKER',
        error: `Mission ${mission.id} has no build worker to rebase.`,
      };
    }
    if (String(worker.runStatus || '').trim().toLowerCase() === 'running') {
      return {
        ok: false,
        code: 'WORKER_RUNNING',
        error: `Worker "${worker.id}" is still running. Wait for it to finish before crew_rebase.`,
        workerId: worker.id,
      };
    }
    if (await isCrewWorktreeDirty(worker.worktreePath)) {
      return {
        ok: false,
        code: 'DIRTY_WORKTREE',
        error: `Worker worktree is dirty: ${worker.id}. Commit or stash before crew_rebase.`,
        workerId: worker.id,
      };
    }

    const baseHead = String((await tryGit(root, ['rev-parse', 'HEAD'])).stdout || '').trim();
    if (!baseHead) {
      return { ok: false, code: 'BASE_HEAD_MISSING', error: 'Could not read the current base tip.' };
    }

    const containsBase = await isCrewCommitAncestor(root, baseHead, worker.branch);
    if (containsBase) {
      await patchCrewWorkerRecord(root, worker.id, { rebaseOnto: '', landBase: baseHead }).catch(() => null);
      return {
        ok: true,
        status: 'up-to-date',
        missionId: mission.id,
        workerId: worker.id,
        onto: baseHead,
        message: `Mission ${mission.id} (${worker.id}) is already up to date with base "${baseBranch}" (${baseHead.slice(0, 12)}). Retry land_workers.`,
      };
    }

    const oldTip = String((await tryGit(root, ['rev-parse', worker.branch])).stdout || '').trim();
    if (!oldTip) {
      return {
        ok: false,
        code: 'REVIEW_COMMIT_MISSING',
        error: `Could not read the current commit for worker "${worker.id}".`,
        workerId: worker.id,
      };
    }

    const hadPassingReview = workerReviewMatchesCommit(worker, oldTip);
    const worktreePath = path.resolve(String(worker.worktreePath || ''));
    const rebased = await tryGit(worktreePath, ['rebase', baseHead]);
    if (rebased.code !== 0) {
      const conflicted = splitNames((await tryGit(worktreePath, ['diff', '--name-only', '--diff-filter=U'])).stdout);
      await abortRebase(worktreePath);
      await patchCrewWorkerRecord(root, worker.id, {
        rebaseOnto: baseHead,
        reviewedCommit: '',
        reviewText: '',
        reviewPassed: false,
      }).catch(() => null);
      return {
        ok: false,
        code: 'RESUME_REQUIRED',
        error: `Rebase of mission ${mission.id} onto ${baseHead.slice(0, 12)} conflicted and was aborted. Resume "${worker.id}" to resolve conflicts in its worktree, then review the new commit. Do not land yet.`,
        workerId: worker.id,
        missionId: mission.id,
        onto: baseHead,
        ...(conflicted.length ? { files: conflicted } : {}),
      };
    }

    const newTip = String((await tryGit(root, ['rev-parse', worker.branch])).stdout || '').trim();
    if (!newTip) {
      return {
        ok: false,
        code: 'REBASE_FAILED',
        error: `Rebase finished but could not read the new tip for "${worker.id}".`,
        workerId: worker.id,
      };
    }

    const patch = {
      rebaseOnto: '',
      landBase: baseHead,
    };
    if (hadPassingReview && await workerDeliverablesUnchanged(root, oldTip, newTip, worker.paths)) {
      patch.reviewedCommit = newTip;
      patch.reviewPassed = true;
    } else if (hadPassingReview) {
      patch.reviewedCommit = '';
      patch.reviewText = '';
      patch.reviewPassed = false;
    }
    await patchCrewWorkerRecord(root, worker.id, patch).catch(() => null);

    const reviewKept = hadPassingReview && patch.reviewPassed === true;
    return {
      ok: true,
      status: 'rebased',
      missionId: mission.id,
      workerId: worker.id,
      fromCommit: oldTip,
      toCommit: newTip,
      onto: baseHead,
      reviewKept,
      message: reviewKept
        ? `Rebased mission ${mission.id} (${worker.id}) onto ${baseBranch} (${baseHead.slice(0, 12)}). Passing review kept — call land_workers for ${mission.id}.`
        : `Rebased mission ${mission.id} (${worker.id}) onto ${baseBranch} (${baseHead.slice(0, 12)}). Dispatch a reviewer for "${worker.id}", then land_workers for ${mission.id}.`,
    };
  });
}
