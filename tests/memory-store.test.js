import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadConfig } from '../src/core/config-store.js';
import { buildMemorySnapshot } from '../src/core/memory-prompt.js';
import { getMemoryBucketMaintenance, getProjectMemoryKey, listMemories, markMemoryBucketMaintained, rememberMemory } from '../src/core/memory-store.js';

async function withTempConfigDir(run) {
  const prev = process.env.CODEMINI_GLOBAL_DIR;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-global-'));
  process.env.CODEMINI_GLOBAL_DIR = dir;
  try {
    await run(dir);
  } finally {
    if (prev === undefined) {
      delete process.env.CODEMINI_GLOBAL_DIR;
    } else {
      process.env.CODEMINI_GLOBAL_DIR = prev;
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('rememberMemory stores user, global, and project memories and renders a compact snapshot', async () => {
  await withTempConfigDir(async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-memory-workspace-'));
    try {
      const config = await loadConfig();
      await rememberMemory({
        scope: 'user',
        content: '用户偏好中文回复。',
        kind: 'preference',
        workspaceRoot,
        config
      });
      await rememberMemory({
        scope: 'global',
        content: '优先使用 rg 搜索代码。',
        kind: 'workflow',
        workspaceRoot,
        config
      });
      await rememberMemory({
        scope: 'project',
        content: 'chat-runtime.js 是核心编排入口，修改时优先补测试。',
        kind: 'architecture',
        workspaceRoot,
        config
      });

      const user = await listMemories({ scope: 'user', workspaceRoot });
      const globalItems = await listMemories({ scope: 'global', workspaceRoot });
      const project = await listMemories({ scope: 'project', workspaceRoot });
      const projectEntries = await fs.readdir(path.join(workspaceRoot, '.codemini', 'memory'));
      const snapshot = await buildMemorySnapshot({ config, workspaceRoot });

      assert.equal(user.length, 1);
      assert.equal(globalItems.length, 1);
      assert.equal(project.length, 1);
      assert.equal(projectEntries.length, 1);
      assert.match(snapshot, /Persistent Memory:/);
      assert.match(snapshot, /preserve command names, file paths, identifiers, and punctuation exactly/i);
      assert.match(snapshot, /User Memory:/);
      assert.match(snapshot, /Global Memory:/);
      assert.match(snapshot, /Project Memory:/);
      assert.match(snapshot, /exact_text=/);
      assert.match(snapshot, /用户偏好中文回复/);
      assert.match(snapshot, /优先使用 rg 搜索代码/);
      assert.match(snapshot, /chat-runtime\.js 是核心编排入口/);
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

test('project memory reads compatible local buckets when path-derived key changes', async () => {
  await withTempConfigDir(async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-memory-workspace-'));
    try {
      const config = await loadConfig();
      const currentKey = getProjectMemoryKey(workspaceRoot);
      const legacyKey = `${currentKey.replace(/-[^-]+$/, '')}-legacykey`;
      const memoryDir = path.join(workspaceRoot, '.codemini', 'memory');
      await fs.mkdir(memoryDir, { recursive: true });
      await fs.writeFile(
        path.join(memoryDir, `${legacyKey}.json`),
        `${JSON.stringify({
          items: [
            {
              id: 'mem_legacy_project',
              scope: 'project',
              projectKey: legacyKey,
              kind: 'convention',
              content: '代码搜索时优先使用 rg，避免使用 grep 命令。',
              summary: '优先使用 rg 而非 grep 进行代码搜索',
              source: 'tool',
              confidence: 0.9,
              createdAt: '2026-04-04T15:03:16.193Z',
              updatedAt: '2026-04-04T15:03:16.193Z'
            }
          ]
        }, null, 2)}\n`,
        'utf8'
      );

      const project = await listMemories({ scope: 'project', workspaceRoot });
      const snapshot = await buildMemorySnapshot({ config, workspaceRoot });

      assert.equal(project.length, 1);
      assert.equal(project[0].id, 'mem_legacy_project');
      assert.match(snapshot, /Project Memory:/);
      assert.match(snapshot, /优先使用 rg 而非 grep/);
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

test('rememberMemory rejects secret-like content and replaces similar items', async () => {
  await withTempConfigDir(async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-memory-workspace-'));
    try {
      const config = await loadConfig();
      await assert.rejects(
        () =>
          rememberMemory({
            scope: 'user',
            content: 'api_key=sk-test-secret',
            kind: 'preference',
            workspaceRoot,
            config
          }),
        /sensitive|secret/i
      );

      const first = await rememberMemory({
        scope: 'project',
        content: '统一使用 bun test 运行测试。',
        kind: 'workflow',
        workspaceRoot,
        config
      });
      const second = await rememberMemory({
        scope: 'project',
        content: '统一使用 bun test 运行测试。',
        kind: 'workflow',
        workspaceRoot,
        config
      });
      const project = await listMemories({ scope: 'project', workspaceRoot });

      assert.equal(project.length, 1);
      assert.equal(first.id, second.id);
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

test('rememberMemory keeps newest entries within per-scope char budget', async () => {
  await withTempConfigDir(async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-memory-workspace-'));
    try {
      const config = await loadConfig();
      config.memory.max_project_chars = 80;
      await rememberMemory({
        scope: 'project',
        content: 'first project memory note that is intentionally a bit long',
        kind: 'workflow',
        workspaceRoot,
        config
      });
      await rememberMemory({
        scope: 'project',
        content: 'second project memory note that should crowd out the first one',
        kind: 'workflow',
        workspaceRoot,
        config
      });

      const project = await listMemories({ scope: 'project', workspaceRoot });
      assert.equal(project.length, 1);
      assert.match(project[0].content, /second project memory note/);
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

test('memory bucket maintenance marker is reset when bucket changes', async () => {
  await withTempConfigDir(async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-memory-maintenance-'));
    try {
      const config = await loadConfig();
      await rememberMemory({
        scope: 'user',
        content: '用户偏好简洁中文回复。',
        kind: 'preference',
        workspaceRoot,
        config
      });
      await markMemoryBucketMaintained({ scope: 'user', workspaceRoot });

      const marked = await getMemoryBucketMaintenance({ scope: 'user', workspaceRoot });
      assert.equal(marked.fresh, true);
      assert.ok(marked.maintainedAt);

      await rememberMemory({
        scope: 'user',
        content: '用户希望回复中适度使用 emoji。',
        kind: 'preference',
        workspaceRoot,
        config
      });

      const afterChange = await getMemoryBucketMaintenance({ scope: 'user', workspaceRoot });
      assert.equal(afterChange.fresh, false);
      assert.equal(afterChange.maintainedAt, '');
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
