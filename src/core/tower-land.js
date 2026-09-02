import path from 'node:path';

import { getProjectTowerWorktreesDir } from './paths.js';
import { runGit } from './process-run.js';
import { fileMatchesTowerPaths, isTowerLandableWorker, normalizeTowerDependsOn, orderTowerWorkersForLand } from './tower-scope.js';
import {
  formatTowerReviewLoopStoppedError,
  listTowerWorkersFromState,
  patchTowerWorkerRecord,
  readTowerStateFile,
  workerLandBaseRef,
  workerReviewMatchesCommit,
} from './tower-store.js';
import {
  isTowerCommitAncestor,
  isTowerWorktreeDirty,
  removeTowerWorktrees,
  withTowerGitLock,
} from './tower-worktree.js';

const LEGACY_TMP_BRANCH = 'codemini-tower/_merge-tmp';
const LEGACY_TMP_WORKTREE_ID = '_merge-tmp';
const GIT_TIMEOUT_MS = 60_000;
const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'Codemini Tower',
  GIT_AUTHOR_EMAIL: 'tower@codemini.local',
  GIT_COMMITTER_NAME: 'Codemini Tower',
  GIT_COMMITTER_EMAIL: 'tower@codemini.local',
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
  const worktreePath = path.resolve(getProjectTowerWorktreesDir(root), LEGACY_TMP_WORKTREE_ID);
  await tryGit(root, ['worktree', 'remove', '--force', worktreePath]);
  await tryGit(root, ['branch', '-D', LEGACY_TMP_BRANCH]);
  await tryGit(root, ['worktree', 'prune']);
}

function parseCheckedOutBranches(porcelain) {
  const branches = new Set();
  for (const line of String(porcelain || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('branch refs/heads/')) {
      branches.add(trimmed.slice('branch refs/heads/'.length).trim());
    }
  }
  return branches;
}

async function listCheckedOutBranches(root) {
  const listed = await tryGit(root, ['worktree', 'list', '--porcelain']);
  return parseCheckedOutBranches(listed.stdout);
}

async function deleteTowerWorkerBranch(root, branch, checkedOut) {
  const name = String(branch || '').trim();
  if (!name.startsWith('codemini-tower/') || name === LEGACY_TMP_BRANCH) {
    return { ok: false, skipped: true, reason: 'not-worker' };
  }
  if (checkedOut.has(name)) {
    return { ok: false, skipped: true, reason: 'checked-out' };
  }
  const deleted = await tryGit(root, ['branch', '-D', name]);
  if (deleted.code !== 0) {
    return {
      ok: false,
      error: String(deleted.stderr || deleted.stdout || '').trim() || `Failed to delete ${name}.`,
    };
  }
  return { ok: true };
}

function buildLandMessage(ordered, kept, commitSha = '') {
  const ids = ordered.map((worker) => worker.id).join(', ');
  const sha = String(commitSha || '').trim();
  const base = sha
    ? `Landed ${ids} onto the current branch (tip ${sha.slice(0, 12)}). The user still controls push.`
    : `Landed ${ids} onto the current branch. The user still controls push.`;
  if (!kept.length) {
    return `${base} Worker branches were deleted.`;
  }
  return `${base} Could not delete: ${kept.join(', ')}. Do not check out those branches until cleanup finishes.`;
}

function buildRebaseRequired(worker, files = []) {
  const onto = String(worker?.rebaseOnto || '').trim();
  const names = Array.isArray(files) ? files.filter(Boolean) : [];
  return {
    ok: false,
    code: 'REBASE_REQUIRED',
    error: `Worker "${worker.id}" conflicts with the current base tip. Resume "${worker.id}" to git rebase onto ${onto}, resolve, commit, then review the new commit. Do not land.`,
    workerId: worker.id,
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
  const escaped = files.filter((file) => !fileMatchesTowerPaths(file, worker.paths));
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

function workerLookupKeys(worker) {
  return [worker?.id, worker?.taskId]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function depsReady(worker, byId, satisfied) {
  return normalizeTowerDependsOn(worker.dependsOn).every((dep) => {
    const target = byId.get(dep);
    return !target || satisfied.has(target);
  });
}

function buildPartialMessage(integrated, pending, baseBranch) {
  const done = integrated.map((worker) => worker.id).join(', ');
  const wait = pending.map((worker) => worker.id).join(', ');
  return `Merged ${done} onto ${baseBranch}. Waiting on ${wait}. Land again after the rest pass review.`;
}

async function classifyWorker(root, baseBranch, worker) {
  if (await isTowerWorktreeDirty(worker.worktreePath)) {
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
        ? formatTowerReviewLoopStoppedError(worker)
        : failedReview
          ? `Worker "${worker.id}" review did not pass. Resume "${worker.id}" with the review text, then review the new commit.`
          : `Worker "${worker.id}" has no passing review for the current commit. Call run_subagent with role: "reviewer" and review: "${worker.id}".`,
      workerId: worker.id,
      worker,
    };
  }
  return { kind: 'ready', worker };
}

async function mergeWorkerOntoBase(root, worker) {
  if (await isTowerCommitAncestor(root, worker.branch)) {
    const head = String((await tryGit(root, ['rev-parse', 'HEAD'])).stdout || '').trim();
    await patchTowerWorkerRecord(root, worker.id, { integrated: true, landBase: head, rebaseOnto: '' }).catch(() => null);
    worker.integrated = true;
    worker.landBase = head;
    return { ok: true, alreadyMerged: true };
  }
  const merged = await tryGit(root, [
    'merge',
    '--no-ff',
    '-m',
    `codemini-tower merge ${worker.id}`,
    worker.branch,
  ]);
  if (merged.code !== 0) {
    const conflicted = splitNames((await tryGit(root, ['diff', '--name-only', '--diff-filter=U'])).stdout);
    await abortMerge(root);
    if (conflicted.length > 0) {
      const onto = String((await tryGit(root, ['rev-parse', 'HEAD'])).stdout || '').trim();
      if (!onto) {
        return {
          ok: false,
          code: 'GIT_MERGE',
          error: String(merged.stderr || merged.stdout || '').trim() || `Failed to merge worker "${worker.id}".`,
          workerId: worker.id,
          files: conflicted,
        };
      }
      worker.rebaseOnto = onto;
      await patchTowerWorkerRecord(root, worker.id, {
        rebaseOnto: onto,
        reviewedCommit: '',
        reviewText: '',
        reviewPassed: false,
      }).catch(() => null);
      return buildRebaseRequired(worker, conflicted);
    }
    return {
      ok: false,
      code: 'GIT_MERGE',
      error: String(merged.stderr || merged.stdout || '').trim() || `Failed to merge worker "${worker.id}".`,
      workerId: worker.id,
    };
  }
  const head = String((await tryGit(root, ['rev-parse', 'HEAD'])).stdout || '').trim();
  worker.integrated = true;
  worker.landBase = head;
  await patchTowerWorkerRecord(root, worker.id, { integrated: true, landBase: head, rebaseOnto: '' }).catch(() => null);
  return { ok: true, alreadyMerged: false };
}

export async function landTowerWorkers({
  cwd = process.cwd(),
  base,
} = {}) {
  const root = path.resolve(cwd);
  const baseBranch = String(base || '').trim();
  if (!baseBranch || baseBranch === 'HEAD') {
    return { ok: false, code: 'NO_BASE', error: 'Tower land needs a recorded git base branch.' };
  }
  return withTowerGitLock(root, async () => {
    await removeLegacyMergeTmp(root).catch(() => null);

    const workers = listTowerWorkersFromState(await readTowerStateFile(root))
      .filter(isTowerLandableWorker);
    if (workers.length === 0) {
      return { ok: false, code: 'NO_WORKERS', error: 'No tower workers to land. Survey workers are not landed.' };
    }
    const ordered = orderTowerWorkersForLand(workers);

    const pendingRebase = [];
    for (const worker of ordered) {
      const onto = String(worker.rebaseOnto || '').trim();
      if (!onto) continue;
      const done = await isTowerCommitAncestor(worker.worktreePath, onto);
      if (!done) {
        pendingRebase.push(worker);
        continue;
      }
      worker.landBase = onto;
      delete worker.rebaseOnto;
      await patchTowerWorkerRecord(root, worker.id, { landBase: onto, rebaseOnto: '' }).catch(() => null);
    }
    if (pendingRebase.length) {
      return buildRebaseRequired(pendingRebase[0]);
    }

    const already = ordered.filter((worker) => worker.integrated === true);
    const rest = ordered.filter((worker) => worker.integrated !== true);

    const classified = [];
    for (const worker of rest) {
      classified.push(await classifyWorker(root, baseBranch, worker));
    }
    const ready = classified.filter((item) => item.kind === 'ready').map((item) => item.worker);
    const blocked = classified.filter((item) => item.kind === 'blocked');

    const byId = new Map();
    for (const worker of ordered) {
      for (const key of workerLookupKeys(worker)) {
        if (!byId.has(key)) byId.set(key, worker);
      }
    }
    const satisfied = new Set(already);
    const toMerge = [];
    for (const worker of orderTowerWorkersForLand(ready)) {
      if (!depsReady(worker, byId, satisfied)) continue;
      toMerge.push(worker);
      satisfied.add(worker);
    }
    const merging = new Set(toMerge);
    const pending = rest.filter((worker) => !merging.has(worker));
    const reviewWait = new Set(['REVIEW_REQUIRED', 'REVIEW_FAILED']);
    const hardBlocked = blocked.filter((item) => !reviewWait.has(item.code));

    if (toMerge.length === 0) {
      if (hardBlocked.length) {
        const { kind, worker, ...error } = hardBlocked[0];
        return { ok: false, ...error };
      }
      if (already.length > 0 && pending.length > 0) {
        return {
          ok: true,
          committed: true,
          integrated: already.map((worker) => worker.id),
          pending: pending.map((worker) => worker.id),
          message: buildPartialMessage(already, pending, baseBranch),
        };
      }
      const first = blocked[0];
      if (first) {
        const { kind, worker, ...error } = first;
        return { ok: false, ...error };
      }
      return { ok: false, code: 'NO_WORKERS', error: 'No tower workers to land.' };
    }

    for (const worker of toMerge) {
      const merged = await mergeWorkerOntoBase(root, worker);
      if (!merged.ok) return merged;
    }

    const stillPending = ordered.filter((worker) => worker.integrated !== true);
    if (stillPending.length > 0) {
      const onBase = ordered.filter((worker) => worker.integrated === true);
      return {
        ok: true,
        committed: true,
        integrated: onBase.map((worker) => worker.id),
        pending: stillPending.map((worker) => worker.id),
        message: buildPartialMessage(onBase, stillPending, baseBranch),
      };
    }

    const commitSha = String((await tryGit(root, ['rev-parse', 'HEAD'])).stdout || '').trim();
    const cleaned = await removeTowerWorktrees({ cwd: root, skipLock: true, force: true });
    const checkedOut = await listCheckedOutBranches(root);
    const kept = [];
    for (const worker of cleaned.kept || []) kept.push(worker.id);
    for (const worker of cleaned.removed || []) {
      const deleted = await deleteTowerWorkerBranch(root, worker.branch, checkedOut);
      if (!deleted.ok) kept.push(worker.id);
    }
    const uniqueKept = [...new Set(kept)];
    return {
      ok: true,
      committed: true,
      commit: commitSha,
      landed: ordered.map((worker) => worker.id),
      kept: uniqueKept,
      message: buildLandMessage(ordered, uniqueKept, commitSha),
    };
  });
}
