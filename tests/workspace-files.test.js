import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  listWorkspaceChildren,
  previewWorkspaceFile,
  resolveWorkspacePath,
  WORKSPACE_PREVIEW_MAX_BYTES,
} from '../codemini-web/lib/workspace-files.js';

async function withTempDir(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-workspace-'));
  try {
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('resolveWorkspacePath rejects path escape', async () => {
  await withTempDir(async (root) => {
    await assert.rejects(
      () => resolveWorkspacePath(root, '../outside'),
      /outside the current project/i,
    );
  });
});

test('listWorkspaceChildren skips INDEX_SKIP_DIRS and sorts dirs first', async () => {
  await withTempDir(async (root) => {
    await fs.mkdir(path.join(root, 'src'));
    await fs.mkdir(path.join(root, 'node_modules'));
    await fs.mkdir(path.join(root, '.git'));
    await fs.writeFile(path.join(root, 'README.md'), '# hi\n');
    await fs.writeFile(path.join(root, 'a.txt'), 'a\n');
    await fs.writeFile(path.join(root, 'node_modules', 'pkg.js'), 'x');

    const result = await listWorkspaceChildren(root, '');
    assert.equal(result.path, '');
    const names = result.entries.map((entry) => entry.name);
    assert.deepEqual(names, ['src', 'a.txt', 'README.md']);
    assert.equal(result.entries[0].type, 'directory');
    assert.deepEqual(result.entries[0].children, []);
    assert.equal(result.entries.find((entry) => entry.name === 'a.txt')?.type, 'file');
  });
});

test('listWorkspaceChildren lists nested relative path', async () => {
  await withTempDir(async (root) => {
    await fs.mkdir(path.join(root, 'src', 'lib'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'lib', 'util.js'), 'export {}\n');
    const result = await listWorkspaceChildren(root, 'src');
    assert.equal(result.path, 'src');
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].path, 'src/lib');
    assert.equal(result.entries[0].type, 'directory');
  });
});

test('previewWorkspaceFile returns truncated text for large files', async () => {
  await withTempDir(async (root) => {
    const payload = `${'x'.repeat(WORKSPACE_PREVIEW_MAX_BYTES + 50)}\n`;
    await fs.writeFile(path.join(root, 'big.txt'), payload);
    const preview = await previewWorkspaceFile(root, 'big.txt');
    assert.equal(preview.kind, 'text');
    assert.equal(preview.truncated, true);
    assert.ok(preview.content.length <= WORKSPACE_PREVIEW_MAX_BYTES);
  });
});

test('previewWorkspaceFile rejects escape and unsupported types', async () => {
  await withTempDir(async (root) => {
    await fs.writeFile(path.join(root, 'photo.bin'), Buffer.from([0, 1, 2, 3, 0, 9]));
    await assert.rejects(
      () => previewWorkspaceFile(root, '../secret'),
      /outside the current project/i,
    );
    const unsupported = await previewWorkspaceFile(root, 'photo.bin');
    assert.equal(unsupported.kind, 'unsupported');
  });
});
