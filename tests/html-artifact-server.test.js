import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  HTML_ARTIFACT_CSP,
  serveHtmlArtifact,
} from '../codemini-web/server.js';

function mockResponse() {
  return {
    status: 0,
    headers: {},
    body: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
}

async function withTempDir(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-html-server-'));
  try {
    return await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('serveHtmlArtifact returns an offline sandboxed interactive document', async () => {
  await withTempDir(async (root) => {
    const html = '<!doctype html><style>button{color:red}</style><button>Go</button><script>document.body.dataset.ready="1"</script>';
    await fs.writeFile(path.join(root, 'demo.html'), html);
    const response = mockResponse();

    const artifact = await serveHtmlArtifact(response, root, 'demo.html');

    assert.equal(response.status, 200);
    assert.equal(response.headers['Content-Type'], 'text/html; charset=utf-8');
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.equal(response.headers['Referrer-Policy'], 'no-referrer');
    assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(response.headers['Content-Security-Policy'], HTML_ARTIFACT_CSP);
    assert.match(HTML_ARTIFACT_CSP, /sandbox allow-scripts/);
    assert.doesNotMatch(HTML_ARTIFACT_CSP, /allow-same-origin/);
    assert.match(HTML_ARTIFACT_CSP, /connect-src 'none'/);
    assert.match(HTML_ARTIFACT_CSP, /form-action 'none'/);
    assert.equal(response.body.toString(), html);
    assert.equal(artifact.path, 'demo.html');
  });
});

test('serveHtmlArtifact rejects non-HTML files and path traversal', async () => {
  await withTempDir(async (root) => {
    await fs.writeFile(path.join(root, 'notes.txt'), 'no');
    await assert.rejects(
      () => serveHtmlArtifact(mockResponse(), root, 'notes.txt'),
      /require.*\.html or \.htm/i,
    );
    await assert.rejects(
      () => serveHtmlArtifact(mockResponse(), root, '../outside.html'),
      /outside the current project/i,
    );
  });
});
