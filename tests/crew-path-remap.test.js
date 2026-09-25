import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { inspectOutsideWorkspaceMutation } from '../src/core/approval-policy.js';
import {
  remapCrewParentPath,
  remapCrewToolArguments,
  resolveCrewParentRoot,
  crewGitWritableRoots,
} from '../src/core/crew-worktree.js';

async function withCrewLayout(task) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-crew-parent-'));
  const worktree = path.join(parent, '.codemini', 'crew', 'worktrees', 'alex');
  try {
    await fs.mkdir(worktree, { recursive: true });
    await fs.mkdir(path.join(parent, 'docs'), { recursive: true });
    return await task({ parent, worktree });
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
}

test('resolveCrewParentRoot walks out of the worker checkout', async () => {
  await withCrewLayout(({ parent, worktree }) => {
    assert.equal(resolveCrewParentRoot(worktree), path.resolve(parent));
    assert.equal(resolveCrewParentRoot(parent), '');
  });
});

test('parent checkout absolute paths remap into the worker worktree', async () => {
  await withCrewLayout(({ parent, worktree }) => {
    const mainFile = path.join(parent, 'docs', 'crew-a.md');
    const remapped = remapCrewParentPath(mainFile, worktree);
    assert.equal(remapped, path.join(worktree, 'docs', 'crew-a.md'));
    assert.equal(remapCrewParentPath('docs/crew-a.md', worktree), 'docs/crew-a.md');
  });
});

test('paths already in the worktree or outside the parent repo stay put', async () => {
  await withCrewLayout(({ parent, worktree }) => {
    const inside = path.join(worktree, 'src', 'app.js');
    assert.equal(remapCrewParentPath(inside, worktree), inside);
    const outside = path.join(os.tmpdir(), 'other-project', 'file.txt');
    assert.equal(remapCrewParentPath(outside, worktree), outside);
    const sibling = path.join(parent, '.codemini', 'crew', 'worktrees', 'bella', 'docs', 'b.md');
    assert.equal(remapCrewParentPath(sibling, worktree), sibling);
  });
});

test('remapCrewToolArguments rewrites write paths and leaves coding roots alone', async () => {
  await withCrewLayout(({ parent, worktree }) => {
    const mainFile = path.join(parent, 'README.md');
    const remapped = remapCrewToolArguments({ path: mainFile, content: 'hi' }, worktree);
    assert.equal(remapped.path, path.join(worktree, 'README.md'));
    assert.equal(remapped.content, 'hi');

    const coding = remapCrewToolArguments({ path: mainFile }, parent);
    assert.equal(coding.path, mainFile);
  });
});

test('remapped parent writes are not outside-workspace mutations', async () => {
  await withCrewLayout(async ({ parent, worktree }) => {
    const mainFile = path.join(parent, 'docs', 'crew-a.md');
    const remapped = remapCrewToolArguments({ path: mainFile, content: 'hi' }, worktree);
    assert.equal(
      await inspectOutsideWorkspaceMutation({
        workspaceRoot: worktree,
        toolName: 'write',
        arguments: remapped,
      }),
      null,
    );
    const elsewhere = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-crew-outside-'));
    try {
      const stillOutside = await inspectOutsideWorkspaceMutation({
        workspaceRoot: worktree,
        toolName: 'write',
        arguments: { path: path.join(elsewhere, 'file.txt'), content: 'x' },
      });
      assert.equal(stillOutside.outsideWorkspace, true);
    } finally {
      await fs.rm(elsewhere, { recursive: true, force: true });
    }
  });
});

test('crewGitWritableRoots only grants parent git commit dirs', async () => {
  await withCrewLayout(({ parent, worktree }) => {
    const roots = crewGitWritableRoots(worktree);
    assert.deepEqual(roots, [
      path.join(parent, '.git', 'objects'),
      path.join(parent, '.git', 'worktrees', 'alex'),
      path.join(parent, '.git', 'refs', 'heads', 'codemini-crew'),
      path.join(parent, '.git', 'logs', 'refs', 'heads', 'codemini-crew'),
    ]);
    assert.equal(crewGitWritableRoots(parent).length, 0);
    assert.equal(crewGitWritableRoots(path.join(parent, '.codemini', 'crew', 'worktrees', 'tmp')).length, 0);
  });
});

test('crewGitWritableRoots prefers the worktree gitdir file when it is under parent .git/worktrees', async () => {
  await withCrewLayout(async ({ parent, worktree }) => {
    await fs.writeFile(
      path.join(worktree, '.git'),
      `gitdir: ${path.join(parent, '.git', 'worktrees', 'alex')}\n`,
    );
    assert.equal(
      crewGitWritableRoots(worktree)[1],
      path.join(parent, '.git', 'worktrees', 'alex'),
    );
    await fs.writeFile(
      path.join(worktree, '.git'),
      `gitdir: ${path.join(parent, '.git')}\n`,
    );
    assert.equal(
      crewGitWritableRoots(worktree)[1],
      path.join(parent, '.git', 'worktrees', 'alex'),
    );
  });
});
