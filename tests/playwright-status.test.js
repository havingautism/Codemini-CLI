import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { detectPlaywrightStatus, webFetchPage } from '../src/core/tools.js';
import { playwrightCoreLoaded } from '../src/core/browser/launch.js';

const noBrowser = {
  findBrowsers: () => [],
  loadLegacy: async () => null,
};

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
    `module.exports = { chromium: { executablePath: () => ${JSON.stringify(chromiumPath)}, launch: async () => { throw new Error('unused'); } } };\n`,
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

test('detectPlaywrightStatus reports a system browser through playwright-core', async () => {
  const binary = path.join(os.tmpdir(), 'codemini-chrome');
  const status = await detectPlaywrightStatus({
    findBrowsers: () => [{ name: 'Chrome', channel: 'chrome', path: binary }],
    loadLegacy: async () => null,
  });
  assert.equal(status.engine, 'playwright-core');
  assert.equal(status.browser, 'chrome');
  assert.equal(status.ready, true);
  assert.equal(status.packageInstalled, true);
  assert.equal(status.chromiumReady, true);
  assert.equal(status.hint, '');
});

test('detectPlaywrightStatus keeps a global Playwright Chromium as the fallback', async () => {
  const missingBrowser = path.join(os.tmpdir(), 'codemini-missing-chromium');
  await withFakeGlobalPlaywright(missingBrowser, async () => {
    const missing = await detectPlaywrightStatus({ findBrowsers: () => [] });
    assert.equal(missing.packageInstalled, true);
    assert.equal(missing.chromiumReady, false);
    assert.equal(missing.ready, false);
    assert.equal(missing.engine, 'none');
    assert.match(missing.hint, /Chrome or Edge/);
    assert.doesNotMatch(missing.hint, /npm install -g playwright/);
  });

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-chromium-'));
  const binary = path.join(dir, 'chrome');
  await fs.writeFile(binary, '', 'utf8');
  try {
    await withFakeGlobalPlaywright(binary, async () => {
      const status = await detectPlaywrightStatus({ findBrowsers: () => [] });
      assert.equal(status.packageInstalled, true);
      assert.equal(status.chromiumReady, true);
      assert.equal(status.ready, true);
      assert.equal(status.engine, 'playwright');
      assert.equal(status.browser, 'chromium');
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('web_fetch returns static HTML and a Chrome or Edge hint when no browser exists', async () => {
  const html = '<!doctype html><html><head><title>Shell</title></head><body><div id="app"></div><script>document.getElementById("app").textContent="RENDERED_TOKEN_12345";</script></body></html>';
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    const result = await webFetchPage({ url, timeout_ms: 5000 }, {}, noBrowser);
    assert.equal(result.metadata.fetch_mode, 'static');
    assert.equal(result.text.includes('RENDERED_TOKEN_12345'), false);
    assert.match(result.warnings.join('\n'), /Chrome or Edge/);
    assert.match(result.warnings.join('\n'), /browser\.executable_path/);
    assert.doesNotMatch(result.warnings.join('\n'), /npm install -g playwright/);
    assert.equal(playwrightCoreLoaded(), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
