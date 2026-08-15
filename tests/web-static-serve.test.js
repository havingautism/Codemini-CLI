import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { serveStatic } from '../codemini-web/server.js';

function mockResponse() {
  return {
    status: 0,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    }
  };
}

test('serveStatic gzips compressible files and immutable-caches fingerprinted assets', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-static-'));
  try {
    const hashed = path.join(dir, 'index-a1b2c3d4e.js');
    const html = path.join(dir, 'index.html');
    await fs.writeFile(hashed, 'console.log("hello-static");');
    await fs.writeFile(html, '<!doctype html><title>t</title>');

    const hashedRes = mockResponse();
    await serveStatic(hashedRes, hashed, { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(hashedRes.status, 200);
    assert.equal(hashedRes.headers['Cache-Control'], 'public, max-age=31536000, immutable');
    assert.equal(hashedRes.headers['Content-Encoding'], 'gzip');
    assert.equal(zlib.gunzipSync(hashedRes.body).toString(), 'console.log("hello-static");');

    const htmlRes = mockResponse();
    await serveStatic(htmlRes, html, { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(htmlRes.status, 200);
    assert.equal(htmlRes.headers['Cache-Control'], 'no-cache');
    assert.equal(htmlRes.headers['Content-Encoding'], 'gzip');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
