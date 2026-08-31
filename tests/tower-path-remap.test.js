import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { inspectOutsideWorkspaceMutation } from '../src/core/approval-policy.js';
import {
  remapTowerParentPath,
  remapTowerToolArguments,
  resolveTowerParentRoot,
} from '../src/core/tower-worktree.js';

async function withTowerLayout(task) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-tower-parent-'));
  const worktree = path.join(parent, '.codemini', 'tower', 'worktrees', 'alex');
  try {
    await fs.mkdir(worktree, { recursive: true });
    await fs.mkdir(path.join(parent, 'docs'), { recursive: true });
    return await task({ parent, worktree });
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
}

test('resolveTowerParentRoot walks out of the worker checkout', async () => {
  await withTowerLayout(({ parent, worktree }) => {
    assert.equal(resolveTowerParentRoot(worktree), path.resolve(parent));
    assert.equal(resolveTowerParentRoot(parent), '');
  });
});

test('parent checkout absolute paths remap into the worker worktree', async () => {
  await withTowerLayout(({ parent, worktree }) => {
    const mainFile = path.join(parent, 'docs', 'tower-a.md');
    const remapped = remapTowerParentPath(mainFile, worktree);
    assert.equal(remapped, path.join(worktree, 'docs', 'tower-a.md'));
    assert.equal(remapTowerParentPath('docs/tower-a.md', worktree), 'docs/tower-a.md');
  });
});

test('paths already in the worktree or outside the parent repo stay put', async () => {
  await withTowerLayout(({ parent, worktree }) => {
    const inside = path.join(worktree, 'src', 'app.js');
    assert.equal(remapTowerParentPath(inside, worktree), inside);
    const outside = path.join(os.tmpdir(), 'other-project', 'file.txt');
    assert.equal(remapTowerParentPath(outside, worktree), outside);
    const sibling = path.join(parent, '.codemini', 'tower', 'worktrees', 'bella', 'docs', 'b.md');
    assert.equal(remapTowerParentPath(sibling, worktree), sibling);
  });
});

test('remapTowerToolArguments rewrites write paths and leaves coding roots alone', async () => {
  await withTowerLayout(({ parent, worktree }) => {
    const mainFile = path.join(parent, 'README.md');
    const remapped = remapTowerToolArguments({ path: mainFile, content: 'hi' }, worktree);
    assert.equal(remapped.path, path.join(worktree, 'README.md'));
    assert.equal(remapped.content, 'hi');

    const coding = remapTowerToolArguments({ path: mainFile }, parent);
    assert.equal(coding.path, mainFile);
  });
});

test('remapped parent writes are not outside-workspace mutations', async () => {
  await withTowerLayout(async ({ parent, worktree }) => {
    const mainFile = path.join(parent, 'docs', 'tower-a.md');
    const remapped = remapTowerToolArguments({ path: mainFile, content: 'hi' }, worktree);
    assert.equal(
      await inspectOutsideWorkspaceMutation({
        workspaceRoot: worktree,
        toolName: 'write',
        arguments: remapped,
      }),
      null,
    );
    const elsewhere = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-tower-outside-'));
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
