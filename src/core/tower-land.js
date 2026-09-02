import fs from 'node:fs/promises';
import path from 'node:path';

import { getProjectTowerWorktreesDir } from './paths.js';
import { runGit } from './process-run.js';
import { fileMatchesTowerPaths, normalizeTowerDependsOn, orderTowerWorkersForLand } from './tower-scope.js';
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

const TMP_BRANCH = 'codemini-tower/_merge-tmp';
const TMP_WORKTREE_ID = '_merge-tmp';
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

async function removeMergeTmp(root) {
  const worktreePath = path.resolve(getProjectTowerWorktreesDir(root), TMP_WORKTREE_ID);
  await tryGit(root, ['worktree', 'remove', '--force', worktreePath]);
  await fs.rm(worktreePath, { recursive: true, force: true }).catch(() => {});
  await tryGit(root, ['branch', '-D', TMP_BRANCH]);
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
  if (!name.startsWith('codemini-tower/') || name === TMP_BRANCH) {
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

function buildLandMessage(ordered, kept) {
  const ids = ordered.map((worker) => worker.id).join(', ');
  const base = `Landed ${ids} onto the current branch with git merge --squash. There is no new commit; the user keeps commit rights.`;
  if (!kept.length) {
    return `${base} Worker branches were deleted.`;
  }
  return `${base} Could not delete: ${kept.join(', ')}. Do not check out those branches until you commit; they can absorb the staged files.`;
}

function buildRebaseRequired(worker, files = []) {
  const onto = String(worker?.rebaseOnto || '').trim();
  const names = Array.isArray(files) ? files.filter(Boolean) : [];
  return {
    ok: false,
    code: 'REBASE_REQUIRED',
    error: `Worker "${worker.id}" conflicts with the current integration tip. Resume "${worker.id}" to git rebase onto ${onto}, resolve, commit, then review the new commit. Do not land.`,
    workerId: worker.id,
    onto,
    ...(names.length ? { files: names } : {}),
  };
}

async function collectScopeEscape(root, base, worker) {
  const against = workerLandBaseRef(worker, base);
  const diff = await tryGit(root, ['diff', '--name-only', String(against), worker.branch]);
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

function buildPartialMessage(integrated, pending) {
  const done = integrated.map((worker) => worker.id).join(', ');
  const wait = pending.map((worker) => worker.id).join(', ');
  return `Integrated ${done} onto the merge tmp. Waiting on ${wait}. Did not squash onto the user branch. Do not delete the merge tmp.`;
}

async function mergeTmpWorktreePath(root) {
  return path.resolve(getProjectTowerWorktreesDir(root), TMP_WORKTREE_ID);
}

async function ensureMergeTmp(root, baseBranch) {
  const mergeWorktree = await mergeTmpWorktreePath(root);
  await fs.mkdir(path.dirname(mergeWorktree), { recursive: true });
  const existing = await tryGit(mergeWorktree, ['rev-parse', 'HEAD']);
  if (existing.code === 0) return { ok: true, mergeWorktree };
  const branchExists = await tryGit(root, ['rev-parse', '--verify', TMP_BRANCH]);
  if (branchExists.code === 0) {
    const added = await tryGit(root, ['worktree', 'add', mergeWorktree, TMP_BRANCH]);
    if (added.code !== 0) {
      return {
        ok: false,
        code: 'TMP_WORKTREE_FAILED',
        error: String(added.stderr || added.stdout || '').trim() || 'Failed to attach tower merge worktree.',
      };
    }
    return { ok: true, mergeWorktree };
  }
  const added = await tryGit(root, ['worktree', 'add', '-b', TMP_BRANCH, mergeWorktree, baseBranch]);
  if (added.code !== 0) {
    return {
      ok: false,
      code: 'TMP_WORKTREE_FAILED',
      error: String(added.stderr || added.stdout || '').trim() || 'Failed to create tower merge worktree.',
    };
  }
  return { ok: true, mergeWorktree };
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
    const workers = listTowerWorkersFromState(await readTowerStateFile(root));
    if (workers.length === 0) {
      return { ok: false, code: 'NO_WORKERS', error: 'No tower workers to land.' };
    }
    const ordered = orderTowerWorkersForLand(workers);
    let keepMergeTmp = false;
    let delivered = false;
    try {
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
        keepMergeTmp = true;
        return buildRebaseRequired(pendingRebase[0]);
      }

      const already = ordered.filter((worker) => worker.integrated === true);
      const rest = ordered.filter((worker) => worker.integrated !== true);
      if (already.length === 0) await removeMergeTmp(root);

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
      const needTmp = already.length > 0 || pending.length > 0 || toMerge.length > 1;
      const reviewWait = new Set(['REVIEW_REQUIRED', 'REVIEW_FAILED']);
      const hardBlocked = blocked.filter((item) => !reviewWait.has(item.code));

      if (toMerge.length === 0) {
        if (hardBlocked.length) {
          keepMergeTmp = already.length > 0;
          const { kind, worker, ...error } = hardBlocked[0];
          return { ok: false, ...error };
        }
        if (already.length > 0 && pending.length > 0) {
          keepMergeTmp = true;
          return {
            ok: true,
            squashed: false,
            integrated: already.map((worker) => worker.id),
            pending: pending.map((worker) => worker.id),
            message: buildPartialMessage(already, pending),
          };
        }
        if (already.length === 0) {
          const first = blocked[0];
          if (first) {
            const { kind, worker, ...error } = first;
            return { ok: false, ...error };
          }
          return { ok: false, code: 'NO_WORKERS', error: 'No tower workers to land.' };
        }
      }

      if (needTmp) {
        const tmp = await ensureMergeTmp(root, baseBranch);
        if (!tmp.ok) return tmp;
        keepMergeTmp = true;
        for (const worker of toMerge) {
          if (await isTowerCommitAncestor(tmp.mergeWorktree, worker.branch)) {
            worker.integrated = true;
            await patchTowerWorkerRecord(root, worker.id, { integrated: true }).catch(() => null);
            continue;
          }
          const merged = await tryGit(tmp.mergeWorktree, [
            'merge',
            '--no-ff',
            '-m',
            `codemini-tower merge ${worker.id}`,
            worker.branch,
          ]);
          if (merged.code !== 0) {
            const conflicted = splitNames((await tryGit(tmp.mergeWorktree, ['diff', '--name-only', '--diff-filter=U'])).stdout);
            await abortMerge(tmp.mergeWorktree);
            const ontoResult = await tryGit(tmp.mergeWorktree, ['rev-parse', 'HEAD']);
            const onto = String(ontoResult.stdout || '').trim();
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
            await patchTowerWorkerRecord(root, worker.id, { rebaseOnto: onto }).catch(() => null);
            return buildRebaseRequired(worker, conflicted);
          }
          worker.integrated = true;
          await patchTowerWorkerRecord(root, worker.id, { integrated: true }).catch(() => null);
        }
        const stillPending = ordered.filter((worker) => worker.integrated !== true);
        if (stillPending.length) {
          const onTmp = ordered.filter((worker) => worker.integrated === true);
          return {
            ok: true,
            squashed: false,
            integrated: onTmp.map((worker) => worker.id),
            pending: stillPending.map((worker) => worker.id),
            message: buildPartialMessage(onTmp, stillPending),
          };
        }
      }

      const squashTarget = needTmp || already.length > 0 ? TMP_BRANCH : toMerge[0].branch;
      const squashed = await tryGit(root, ['merge', '--squash', squashTarget]);
      if (squashed.code !== 0) {
        await abortMerge(root);
        if (needTmp) keepMergeTmp = true;
        return {
          ok: false,
          code: 'GIT_SQUASH',
          error: String(squashed.stderr || squashed.stdout || '').trim() || 'git merge --squash failed.',
        };
      }

      const cleaned = await removeTowerWorktrees({ cwd: root, skipLock: true, force: true });
      const checkedOut = await listCheckedOutBranches(root);
      const kept = [];
      for (const worker of cleaned.kept || []) kept.push(worker.id);
      for (const worker of cleaned.removed || []) {
        const deleted = await deleteTowerWorkerBranch(root, worker.branch, checkedOut);
        if (!deleted.ok) kept.push(worker.id);
      }
      const uniqueKept = [...new Set(kept)];
      delivered = true;
      keepMergeTmp = false;
      return {
        ok: true,
        squashed: true,
        landed: ordered.map((worker) => worker.id),
        kept: uniqueKept,
        message: buildLandMessage(ordered, uniqueKept),
      };
    } finally {
      if (delivered || !keepMergeTmp) await removeMergeTmp(root);
    }
  });
}
