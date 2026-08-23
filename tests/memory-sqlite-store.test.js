import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { rememberMemory, listMemories, forgetMemory, searchMemories } from '../src/core/memory-store.js';
import { withMemoryEnv } from './helpers/memory-env.js';

test('rememberMemory persists to sqlite and listMemories reads it back with family', async () => {
  await withMemoryEnv(async (dir) => {
    const saved = await rememberMemory({
      scope: 'user',
      kind: 'preference',
      content: 'User prefers pnpm',
      summary: 'prefers pnpm',
      workspaceRoot: dir,
      config: { memory: { max_items_per_scope: 50 } }
    });
    assert.equal(saved.family, 'personal');
    const items = await listMemories({ scope: 'user', workspaceRoot: dir });
    assert.equal(items.length, 1);
    assert.equal(items[0].content, 'User prefers pnpm');
    assert.equal(items[0].family, 'personal');
    assert.equal(typeof items[0].hitCount, 'number');
    assert.equal(typeof items[0].utilityScore, 'number');
  });
});

test('forgetMemory removes sqlite rows', async () => {
  await withMemoryEnv(async (dir) => {
    const saved = await rememberMemory({
      scope: 'global',
      kind: 'lesson',
      content: 'PowerShell does not support bash source',
      workspaceRoot: dir,
      config: { memory: { max_items_per_scope: 50 } }
    });
    const result = await forgetMemory({ scope: 'global', id: saved.id, workspaceRoot: dir });
    assert.equal(result.removed, 1);
    const items = await listMemories({ scope: 'global', workspaceRoot: dir });
    assert.equal(items.length, 0);
  });
});

test('searchMemories uses FTS rather than exact substring only', async () => {
  await withMemoryEnv(async (dir) => {
    await rememberMemory({
      scope: 'global',
      kind: 'lesson',
      content: 'Windows 下 pnpm 脚本应该通过 PowerShell 执行，而不是 bash source',
      summary: 'Windows pnpm via PowerShell',
      workspaceRoot: dir,
      config: { memory: { max_items_per_scope: 50 } }
    });
    const hits = await searchMemories({
      scope: 'global',
      query: 'Windows package script fails',
      workspaceRoot: dir
    });
    assert.ok(hits.length >= 1);
    assert.match(hits[0].content, /pnpm/);
  });
});

test('project memories stay in the project database and do not leak across repos', async () => {
  await withMemoryEnv(async (dir) => {
    const projectA = path.join(dir, 'proj-a');
    const projectB = path.join(dir, 'proj-b');
    await rememberMemory({
      scope: 'project',
      kind: 'lesson',
      content: 'Project A cannot use pnpm exec tsx',
      workspaceRoot: projectA,
      config: { memory: { max_items_per_scope: 50 } }
    });
    const fromA = await listMemories({ scope: 'project', workspaceRoot: projectA });
    const fromB = await listMemories({ scope: 'project', workspaceRoot: projectB });
    assert.equal(fromA.length, 1);
    assert.equal(fromB.length, 0);
  });
});
