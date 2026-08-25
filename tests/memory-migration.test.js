import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { listMemories } from '../src/core/memory-store.js';
import { getMemoryDir, getProjectMemoryDir } from '../src/core/paths.js';
import { withMemoryEnv } from './helpers/memory-env.js';

test('legacy JSON user/global memories import into sqlite once', async () => {
  await withMemoryEnv(async (dir) => {
    const memoryDir = getMemoryDir();
    await fs.mkdir(memoryDir, { recursive: true });
    await fs.writeFile(path.join(memoryDir, 'user.json'), `${JSON.stringify({
      items: [{
        id: 'mem_legacy_user',
        kind: 'preference',
        content: 'User likes concise replies',
        summary: 'concise replies',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }]
    }, null, 2)}\n`, 'utf8');

    const first = await listMemories({ scope: 'user', workspaceRoot: dir });
    assert.equal(first.length, 1);
    assert.equal(first[0].id, 'mem_legacy_user');
    assert.equal(first[0].family, 'personal');

    await fs.writeFile(path.join(memoryDir, 'user.json'), `${JSON.stringify({
      items: [{ id: 'mem_should_not_import', kind: 'note', content: 'stale json' }]
    }, null, 2)}\n`, 'utf8');
    const second = await listMemories({ scope: 'user', workspaceRoot: dir });
    assert.equal(second.length, 1);
    assert.equal(second[0].id, 'mem_legacy_user');
    const raw = await fs.readFile(path.join(memoryDir, 'user.json'), 'utf8');
    assert.match(raw, /mem_should_not_import/);
  });
});

test('legacy project JSON memories import into project sqlite', async () => {
  await withMemoryEnv(async (dir) => {
    const projectDir = path.join(dir, 'repo');
    const memoryDir = getProjectMemoryDir(projectDir);
    await fs.mkdir(memoryDir, { recursive: true });
    await fs.writeFile(path.join(memoryDir, 'project.json'), `${JSON.stringify({
      items: [{
        id: 'mem_legacy_project',
        kind: 'convention',
        content: '该项目使用 pnpm',
        summary: 'pnpm',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }]
    }, null, 2)}\n`, 'utf8');

    const items = await listMemories({ scope: 'project', workspaceRoot: projectDir });
    assert.equal(items.length, 1);
    assert.equal(items[0].id, 'mem_legacy_project');
    assert.equal(items[0].family, 'repo');
  });
});
