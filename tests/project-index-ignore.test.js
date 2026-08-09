import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeProjectIndex } from '../src/core/project-index.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';

test('project index follows gitignore anchors and negation rules', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-index-ignore-'));
  t.after(async () => {
    closeSqliteDatabasesForTests();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'nested'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}\n');
  await fs.writeFile(path.join(root, '.gitignore'), '/ignored.js\n*.tmp.js\n!keep.tmp.js\n');
  await fs.writeFile(path.join(root, 'ignored.js'), 'export const ignored = true;\n');
  await fs.writeFile(path.join(root, 'nested', 'ignored.js'), 'export const nested = true;\n');
  await fs.writeFile(path.join(root, 'src', 'drop.tmp.js'), 'export const drop = true;\n');
  await fs.writeFile(path.join(root, 'keep.tmp.js'), 'export const keep = true;\n');

  const result = await initializeProjectIndex(root);
  const files = result.fileIndex.files.map((entry) => entry.file);

  assert.equal(result.projectMap.gitignoreEnabled, true);
  assert.equal(files.includes('ignored.js'), false);
  assert.equal(files.includes('src/drop.tmp.js'), false);
  assert.equal(files.includes('nested/ignored.js'), true);
  assert.equal(files.includes('keep.tmp.js'), true);
});
