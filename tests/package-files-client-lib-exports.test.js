import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

test('package files includes every client lib re-exported by codemini-web/lib', async () => {
  const root = path.resolve('.');
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const files = new Set(pkg.files || []);
  const libDir = path.join(root, 'codemini-web', 'lib');
  const libEntries = await fs.readdir(libDir);
  const missing = [];

  for (const name of libEntries) {
    if (!name.endsWith('.js')) continue;
    const source = await fs.readFile(path.join(libDir, name), 'utf8');
    for (const match of source.matchAll(/from ['"](\.\.\/client\/src\/lib\/[^'"]+)['"]/g)) {
      const rel = path.posix.join('codemini-web', match[1].replace(/^\.\.\//, ''));
      if (!files.has(rel)) missing.push(`${name} -> ${rel}`);
    }
  }

  assert.deepEqual(missing, [], `publish files missing client re-exports:\n${missing.join('\n')}`);
});
