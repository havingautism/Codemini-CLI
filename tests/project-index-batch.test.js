import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  initializeProjectIndex,
  refreshIndexedFiles,
} from '../src/core/project-index.js';

test('refreshIndexedFiles batches multiple changed files into one index write per project', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-index-batch-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}\n', 'utf8');
  await fs.mkdir(path.join(root, 'src'));
  await fs.writeFile(path.join(root, 'src', 'a.js'), 'export const a = () => 1;\n', 'utf8');
  await fs.writeFile(path.join(root, 'src', 'b.js'), 'export const b = () => 2;\n', 'utf8');
  await initializeProjectIndex(root);

  await fs.writeFile(path.join(root, 'src', 'a.js'), 'export const a = () => 3;\n', 'utf8');
  await fs.writeFile(path.join(root, 'src', 'b.js'), 'export const b = () => 4;\n', 'utf8');

  const result = await refreshIndexedFiles(root, ['src/a.js', 'src/b.js']);

  assert.equal(result.updatedProjects, 1);
  assert.equal(result.indexWrites, 1);
  assert.deepEqual(
    result.files.map((entry) => [entry.path, entry.action]),
    [
      ['src/a.js', 'updated'],
      ['src/b.js', 'updated'],
    ],
  );
});
