import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { rememberMemory, searchMemories } from '../src/core/memory-store.js';
import { retrieveMemories } from '../src/core/memory-retriever.js';
import { buildMemorySnapshot } from '../src/core/memory-prompt.js';
import { withMemoryEnv } from './helpers/memory-env.js';

const STORE_CONFIG = { memory: { max_items_per_scope: 50, max_prompt_chars: 8000 } };

test('Case A: high-value project convention is injected for a new session install task', async () => {
  await withMemoryEnv(async (dir) => {
    await rememberMemory({
      scope: 'project',
      kind: 'convention',
      content: '该项目使用 pnpm',
      summary: 'package manager is pnpm',
      workspaceRoot: dir,
      config: STORE_CONFIG
    });
    const snapshot = await buildMemorySnapshot({
      config: { memory: { enabled: true, inject_on_session_start: true, retrieval: { enabled: true, turn_limit: 5 } } },
      workspaceRoot: dir,
      query: '安装一个 dependency'
    });
    assert.match(snapshot, /pnpm/);
    assert.match(snapshot, /<memory_profile>|<retrieved_memory>/);
  });
});

test('Case D/E: project lessons stay isolated while global lessons recall everywhere', async () => {
  await withMemoryEnv(async (dir) => {
    const projectA = path.join(dir, 'proj-a');
    const projectB = path.join(dir, 'proj-b');
    await rememberMemory({
      scope: 'project',
      kind: 'lesson',
      content: 'Project A node-pty workaround is to pin 0.6.9',
      workspaceRoot: projectA,
      config: STORE_CONFIG
    });
    await rememberMemory({
      scope: 'global',
      kind: 'lesson',
      content: 'PowerShell 不支持 Bash 的 source 命令，应使用 . 或直接运行脚本',
      workspaceRoot: projectA,
      config: STORE_CONFIG
    });

    const [fromA, fromB, globalB] = await Promise.all([
      retrieveMemories({ query: 'node-pty workaround', workspaceRoot: projectA, config: STORE_CONFIG }),
      retrieveMemories({ query: 'node-pty workaround', workspaceRoot: projectB, config: STORE_CONFIG }),
      retrieveMemories({ query: 'PowerShell source', workspaceRoot: projectB, config: STORE_CONFIG })
    ]);
    assert.ok(fromA.some((item) => /node-pty/.test(item.content)));
    assert.equal(fromB.filter((item) => /node-pty/.test(item.content)).length, 0);
    assert.ok(globalB.some((item) => /PowerShell/.test(item.content)));
  });
});

test('Case F: retrieval works when embedding is disabled', async () => {
  await withMemoryEnv(async (dir) => {
    await rememberMemory({
      scope: 'global',
      kind: 'lesson',
      content: 'Windows 下 pnpm 脚本应该通过 PowerShell 执行',
      summary: 'Windows pnpm via PowerShell',
      workspaceRoot: dir,
      config: STORE_CONFIG
    });
    const hits = await searchMemories({
      scope: 'all',
      query: 'Windows package script',
      workspaceRoot: dir,
      config: { memory: { retrieval: { mode: 'fts' }, embedding: { enabled: false } } }
    });
    assert.ok(hits.length >= 1);
  });
});
