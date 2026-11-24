import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { webFetchPage } from '../src/core/tools.js';
import { openWebFetchBrowser } from '../src/core/browser/web-fetch-browser.js';
import { playwrightCoreLoaded } from '../src/core/browser/launch.js';

const noBrowser = {
  findBrowsers: () => [],
  loadLegacy: async () => null,
};

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

test('web_fetch uses an existing Playwright Chromium when no system browser is found', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-chromium-'));
  const binary = path.join(dir, 'chrome');
  await fs.writeFile(binary, '', 'utf8');
  let closed = false;
  try {
    const opened = await openWebFetchBrowser({}, {
      findBrowsers: () => [],
      loadLegacy: async () => ({
        chromium: {
          executablePath: () => binary,
          launch: async () => ({ close: async () => { closed = true; } }),
        },
      }),
    });
    assert.equal(opened.engine, 'playwright');
    assert.equal(opened.browserName, 'chromium');
    await opened.browser.close();
    assert.equal(closed, true);
    assert.equal(playwrightCoreLoaded(), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
