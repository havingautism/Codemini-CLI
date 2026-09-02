import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateTowerParentCommand,
  TOWER_PARENT_SHELL_BLOCK,
} from '../src/core/tower-shell.js';

test('tower parent shell allows inspect commands', () => {
  for (const command of [
    'git status',
    'git log -1 --oneline',
    'git diff',
    'git show HEAD',
    'git rev-parse HEAD',
    'ls',
    'rg Tower src',
    'pwd',
  ]) {
    const result = evaluateTowerParentCommand(command);
    assert.equal(result.allowed, true, command);
  }
});

test('tower parent shell denies merge, checkout, worktree, and copy', () => {
  for (const command of [
    'git merge feature',
    'git merge --squash other',
    'git checkout main',
    'git worktree add /tmp/x',
    'git commit -m wip',
    'git rebase origin/main',
    'git push origin main',
    'cp notes.md ../notes.md',
    'mv src/a.ts src/b.ts',
    'rm notes.md',
    'npm test',
    'echo hi > out.txt',
    'git status && git merge feature',
  ]) {
    const result = evaluateTowerParentCommand(command);
    assert.equal(result.allowed, false, command);
    assert.equal(result.reason, TOWER_PARENT_SHELL_BLOCK, command);
  }
});

test('tower parent shell denies Windows redirections even when risk is not write-high-risk', () => {
  const result = evaluateTowerParentCommand('echo hi > out.txt', 'win32');
  assert.equal(result.allowed, false);
  assert.equal(result.reason, TOWER_PARENT_SHELL_BLOCK);
});
