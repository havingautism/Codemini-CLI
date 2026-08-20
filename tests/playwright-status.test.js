import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  detectPlaywrightStatus,
} from '../src/core/tools.js';

async function withFakeGlobalPlaywright(chromiumPath, fn) {
  const prefix = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-pw-global-'));
  const root = path.join(prefix, 'node_modules');
  const pkgDir = path.join(root, 'playwright');
  await fs.mkdir(pkgDir, { recursive: true });
  await fs.writeFile(
    path.join(pkgDir, 'package.json'),
    `${JSON.stringify({ name: 'playwright', main: 'index.js' })}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(pkgDir, 'index.js'),
    `module.exports = { chromium: { executablePath: () => ${JSON.stringify(chromiumPath)} } };\n`,
    'utf8',
  );
  const previous = process.env.CODEMINI_NPM_GLOBAL_NODE_MODULES;
  process.env.CODEMINI_NPM_GLOBAL_NODE_MODULES = root;
  try {
    return await fn(root);
  } finally {
    if (previous === undefined) delete process.env.CODEMINI_NPM_GLOBAL_NODE_MODULES;
    else process.env.CODEMINI_NPM_GLOBAL_NODE_MODULES = previous;
    await fs.rm(prefix, { recursive: true, force: true });
  }
}

test('detectPlaywrightStatus finds a globally installed playwright package', async () => {
  const missingBrowser = path.join(os.tmpdir(), 'codemini-missing-chromium');
  await withFakeGlobalPlaywright(missingBrowser, async () => {
    const status = await detectPlaywrightStatus();
    assert.equal(status.packageInstalled, true);
    assert.equal(status.chromiumReady, false);
  });
});

test('detectPlaywrightStatus treats an existing chromium binary as ready', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-chromium-'));
  const binary = path.join(dir, 'chrome');
  await fs.writeFile(binary, '', 'utf8');
  try {
    await withFakeGlobalPlaywright(binary, async () => {
      const status = await detectPlaywrightStatus();
      assert.equal(status.packageInstalled, true);
      assert.equal(status.chromiumReady, true);
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
