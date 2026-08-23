import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { rememberMemory, listMemories, searchMemories } from '../src/core/memory-store.js';
import { retrieveMemories, renderRecoveryMemory } from '../src/core/memory-retriever.js';
import { composeMemorySnapshot, buildMemorySnapshot } from '../src/core/memory-prompt.js';
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
    const composed = await composeMemorySnapshot({
      config: { memory: { enabled: true, inject_on_session_start: true, retrieval: { enabled: true, turn_limit: 5 } } },
      workspaceRoot: dir,
      query: '安装一个 dependency'
    });
    assert.equal(composed.inject.query, '安装一个 dependency');
    assert.ok(
      composed.inject.profile.some((item) => /pnpm/i.test(item.summary))
      || composed.inject.retrieved.some((item) => /pnpm/i.test(item.summary))
    );
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

test('Case F: FTS retrieval works without embedding config', async () => {
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
      config: { memory: { retrieval: { mode: 'fts' } } }
    });
    assert.ok(hits.length >= 1);
  });
});

test('session profile keeps pinned/personal/conventions and drops a random recent note', async () => {
  await withMemoryEnv(async (dir) => {
    await rememberMemory({
      scope: 'project',
      kind: 'convention',
      content: '该项目使用 pnpm',
      summary: 'package manager is pnpm',
      workspaceRoot: dir,
      config: STORE_CONFIG
    });
    await rememberMemory({
      scope: 'project',
      kind: 'note',
      content: 'temporary scratch: the last build used port 3847',
      summary: 'scratch port 3847',
      workspaceRoot: dir,
      config: STORE_CONFIG
    });
    const snapshot = await buildMemorySnapshot({
      config: { memory: { enabled: true, inject_on_session_start: true, retrieval: { enabled: false } } },
      workspaceRoot: dir
    });
    assert.match(snapshot, /pnpm/);
    assert.doesNotMatch(snapshot, /3847/);
  });
});

test('archived memories are not retrieved', async () => {
  await withMemoryEnv(async (dir) => {
    const saved = await rememberMemory({
      scope: 'global',
      kind: 'lesson',
      content: 'Do not use the retired sandbox wrapper',
      summary: 'retired sandbox wrapper',
      lifecycle: 'archived',
      workspaceRoot: dir,
      config: STORE_CONFIG
    });
    assert.equal(saved.lifecycle, 'archived');
    const hits = await retrieveMemories({
      query: 'sandbox wrapper',
      workspaceRoot: dir,
      config: STORE_CONFIG
    });
    assert.equal(hits.filter((item) => item.id === saved.id).length, 0);
  });
});

test('pinned critical convention is guaranteed even without a retrieval query', async () => {
  await withMemoryEnv(async (dir) => {
    await rememberMemory({
      scope: 'project',
      kind: 'convention',
      pinned: true,
      content: 'Do not automatically commit changes.',
      summary: 'never auto-commit',
      workspaceRoot: dir,
      config: STORE_CONFIG
    });
    const snapshot = await buildMemorySnapshot({
      config: { memory: { enabled: true, bootstrap: { enabled: true }, retrieval: { enabled: false } } },
      workspaceRoot: dir
    });
    assert.match(snapshot, /<guaranteed_memory>/);
    assert.match(snapshot, /automatically commit/i);
  });
});

test('bootstrap profile does not count as access, retrieval hits do', async () => {
  await withMemoryEnv(async (dir) => {
    await rememberMemory({
      scope: 'user',
      kind: 'preference',
      content: 'User prefers pnpm',
      summary: 'prefers pnpm',
      workspaceRoot: dir,
      config: STORE_CONFIG
    });
    await rememberMemory({
      scope: 'global',
      kind: 'lesson',
      content: 'Windows 下 pnpm 脚本应该通过 PowerShell 执行',
      summary: 'Windows pnpm via PowerShell',
      workspaceRoot: dir,
      config: STORE_CONFIG
    });
    await buildMemorySnapshot({
      config: { memory: { enabled: true, bootstrap: { enabled: true }, retrieval: { enabled: false } } },
      workspaceRoot: dir
    });
    const [pref] = await listMemories({ scope: 'user', workspaceRoot: dir });
    assert.equal(pref.hitCount, 0);
    await retrieveMemories({
      query: 'Windows package script',
      workspaceRoot: dir,
      config: STORE_CONFIG
    });
    const [lesson] = await listMemories({ scope: 'global', workspaceRoot: dir });
    assert.ok(lesson.hitCount >= 1);
  });
});

test('recovery memory block wraps coding lessons for the next turn', () => {
  const block = renderRecoveryMemory([{
    family: 'coding',
    kind: 'lesson',
    summary: 'use node instead of tsx',
    content: '该项目未安装 tsx'
  }]);
  assert.match(block, /<recovery_memory>/);
  assert.match(block, /tsx/);
});

test('retrieved memory rides the user turn, not the system prompt tail', async () => {
  await withMemoryEnv(async (dir) => {
    await rememberMemory({
      scope: 'global',
      kind: 'lesson',
      family: 'coding',
      content: 'Use node instead of pnpm exec tsx in this repo',
      summary: 'node not tsx',
      workspaceRoot: dir,
      config: STORE_CONFIG
    });
    const composed = await composeMemorySnapshot({
      config: { memory: { enabled: true, bootstrap: { enabled: true }, retrieval: { enabled: true, turn_limit: 5 } } },
      workspaceRoot: dir,
      query: 'run the tsx migration'
    });
    // System prompt tail keeps profile/guaranteed but drops retrieved memory.
    assert.doesNotMatch(composed.text, /<retrieved_memory>/);
    // Retrieved memory is returned separately, for the user turn.
    assert.match(composed.retrievedText, /<retrieved_memory>/);
    assert.match(composed.retrievedText, /tsx/);
    // Structured inject still carries retrieved hits for the trajectory UI.
    assert.ok(composed.inject.retrieved.some((item) => /tsx/i.test(item.summary || item.content)));
  });
});
