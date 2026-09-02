import fs from 'node:fs/promises';
import path from 'node:path';

import { getProjectTowerWorktreesDir } from './paths.js';
import { runGit } from './process-run.js';
import { fileMatchesTowerPaths, orderTowerWorkersForLand } from './tower-scope.js';
import { listTowerWorkersFromState, readTowerStateFile, workerReviewMatchesCommit } from './tower-store.js';
import {
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

async function collectScopeEscape(root, base, worker) {
  const diff = await tryGit(root, ['diff', '--name-only', String(base), worker.branch]);
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
    try {
      await removeMergeTmp(root);
      const dirty = [];
      for (const worker of ordered) {
        if (await isTowerWorktreeDirty(worker.worktreePath)) {
          dirty.push(worker.id);
        }
      }
      if (dirty.length) {
        return {
          ok: false,
          code: 'DIRTY_WORKTREE',
          error: `Worker worktree still dirty (not sealed): ${dirty.join(', ')}. Do not land until that worker git commits.`,
          workers: dirty,
        };
      }
      for (const worker of ordered) {
        const scope = await collectScopeEscape(root, baseBranch, worker);
        if (!scope.ok) return scope;
      }
      for (const worker of ordered) {
        const tip = await tryGit(root, ['rev-parse', worker.branch]);
        const commit = String(tip.stdout || '').trim();
        if (tip.code !== 0 || !commit) {
          return {
            ok: false,
            code: 'REVIEW_COMMIT_MISSING',
            error: `Could not read the current commit for worker "${worker.id}".`,
            workerId: worker.id,
          };
        }
        if (!workerReviewMatchesCommit(worker, commit)) {
          const sameCommit = String(worker.reviewedCommit || '').trim() === commit;
          const failedReview = worker.reviewPassed === false && sameCommit;
          return {
            ok: false,
            code: failedReview ? 'REVIEW_FAILED' : 'REVIEW_REQUIRED',
            error: failedReview
              ? `Worker "${worker.id}" review did not pass. Resume "${worker.id}" with the review text, then review the new commit.`
              : `Worker "${worker.id}" has no passing review for the current commit. Call run_subagent with role: "reviewer" and review: "${worker.id}".`,
            workerId: worker.id,
          };
        }
      }

      const useTmp = ordered.length > 1;
      const squashTarget = useTmp ? TMP_BRANCH : ordered[0].branch;
      if (useTmp) {
        const mergeWorktree = path.resolve(getProjectTowerWorktreesDir(root), TMP_WORKTREE_ID);
        await fs.mkdir(path.dirname(mergeWorktree), { recursive: true });
        const added = await tryGit(root, ['worktree', 'add', '-b', TMP_BRANCH, mergeWorktree, baseBranch]);
        if (added.code !== 0) {
          return {
            ok: false,
            code: 'TMP_WORKTREE_FAILED',
            error: String(added.stderr || added.stdout || '').trim() || 'Failed to create tower merge worktree.',
          };
        }
        for (const worker of ordered) {
          const merged = await tryGit(mergeWorktree, [
            'merge',
            '--no-ff',
            '-m',
            `codemini-tower merge ${worker.id}`,
            worker.branch,
          ]);
          if (merged.code !== 0) {
            await abortMerge(mergeWorktree);
            const conflicted = splitNames((await tryGit(mergeWorktree, ['diff', '--name-only', '--diff-filter=U'])).stdout);
            return {
              ok: false,
              code: 'GIT_MERGE',
              error: String(merged.stderr || merged.stdout || '').trim() || `Failed to merge worker "${worker.id}".`,
              workerId: worker.id,
              files: conflicted,
            };
          }
        }
      }

      const squashed = await tryGit(root, ['merge', '--squash', squashTarget]);
      if (squashed.code !== 0) {
        await abortMerge(root);
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
      return {
        ok: true,
        landed: ordered.map((worker) => worker.id),
        kept: uniqueKept,
        message: buildLandMessage(ordered, uniqueKept),
      };
    } finally {
      await removeMergeTmp(root);
    }
  });
}
