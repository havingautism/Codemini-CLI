import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBuiltinTools, webFetchPage } from '../src/core/tools.js';

const enabled = process.env.CODEMINI_BROWSER_TESTS === '1';
const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'browser');

function contentType(file) {
  const extension = path.extname(file);
  if (extension === '.html') return 'text/html; charset=utf-8';
  if (extension === '.css') return 'text/css; charset=utf-8';
  if (extension === '.map' || extension === '.json') return 'application/json; charset=utf-8';
  if (extension === '.svg') return 'image/svg+xml';
  return 'text/javascript; charset=utf-8';
}

function inside(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function startServer(root) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/probe.json') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end('{"ok":true}');
      return;
    }
    let file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!inside(path.resolve(root), file)) {
      response.writeHead(403);
      response.end();
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': contentType(file) });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/` });
    });
  });
}

function browserConfig() {
  return {
    execution: { mode: 'coding' },
    browser: {
      headless: true,
      channel: process.env.CODEMINI_BROWSER_CHANNEL || 'auto',
      executable_path: process.env.CODEMINI_BROWSER_EXECUTABLE || '',
    },
  };
}

async function withPage(workspaceRoot, serverRoot, run) {
  const server = await startServer(serverRoot);
  const bundle = getBuiltinTools({ workspaceRoot, config: browserConfig() });
  try {
    const opened = await bundle.handlers.browser_act({ action: 'open', url: server.url, timeout_ms: 30000 });
    assert.equal(opened.ok, true, JSON.stringify(opened));
    await run(bundle.handlers, opened);
  } finally {
    await bundle.handlers.browser_act({ action: 'close' }).catch(() => {});
    await bundle.dispose?.();
    await new Promise((resolve) => server.server.close(resolve));
  }
}

test('plain page diagnostics', { skip: !enabled, timeout: 180000 }, async () => {
  await withPage(path.join(fixtureRoot, 'plain'), path.join(fixtureRoot, 'plain'), async (handlers, opened) => {
    const snap = await handlers.browser_inspect({ action: 'snapshot', incremental: false, max_chars: 6000 });
    assert.equal(snap.ok, true, JSON.stringify(snap));
    assert.ok(snap.refs.some((ref) => ref.name === 'Styled'));
    assert.ok(snap.summary.length > 40);
    assert.ok(snap.summary.length <= 6000);
    const styled = snap.refs.find((ref) => ref.name === 'Styled');
    const clicked = await handlers.browser_act({ action: 'click', ref: styled.ref });
    assert.equal(clicked.ok, true, JSON.stringify(clicked));

    const occluded = await handlers.browser_diagnose({ action: 'click', selector: '#occluded', observe_ms: 200, timeout_ms: 3000 });
    assert.equal(occluded.ok, true, JSON.stringify(occluded));
    assert.equal(occluded.hit.reason, 'occluded');
    assert.equal(occluded.hit.occluded, true);
    assert.ok(occluded.hit.chain.some((node) => node.id === 'cover'));

    const noPointer = await handlers.browser_diagnose({ action: 'click', selector: '#no-pointer', observe_ms: 100, timeout_ms: 3000 });
    assert.equal(noPointer.hit.reason, 'pointer-events-none', JSON.stringify(noPointer.hit));

    const disabled = await handlers.browser_diagnose({ action: 'click', selector: '#disabled', observe_ms: 100 });
    assert.equal(disabled.hit.reason, 'disabled');
    assert.equal(disabled.click.ok, false);

    const thrown = await handlers.browser_diagnose({ action: 'click', selector: '#throws', observe_ms: 500, timeout_ms: 5000 });
    assert.equal(thrown.click.ok, true, JSON.stringify(thrown.click));
    assert.ok(thrown.exceptions.some((item) => /handler blew up/.test(item.text)), JSON.stringify(thrown.exceptions));

    const style = await handlers.browser_inspect({ action: 'explain_style', selector: '#styled', properties: ['color'] });
    assert.equal(style.ok, true, JSON.stringify(style));
    assert.match(style.computed.color, /0,\s*0,\s*255|blue/);
    assert.ok(style.winning.some((item) => item.property === 'color' && /0,\s*0,\s*255|blue/.test(item.value)), JSON.stringify(style.winning));
    assert.ok(style.overridden.some((item) => item.property === 'color' && item.value === 'red'), JSON.stringify(style.overridden));

    const listeners = await handlers.browser_inspect({ action: 'listeners', selector: '#throws', types: ['click'] });
    assert.equal(listeners.ok, true, JSON.stringify(listeners));
    assert.ok(listeners.listeners.some((listener) => /handler-source\.js/.test(listener.location?.file || '')), JSON.stringify(listeners.listeners));

    const located = await handlers.browser_inspect({ action: 'locate_source', selector: '#throws' });
    assert.equal(located.ok, true, JSON.stringify(located));
    assert.ok(located.locations.some((location) => /handler-source\.js/.test(location.file)), JSON.stringify(located.locations));

    const mutated = await handlers.browser_diagnose({ action: 'click', selector: '#mutates', observe_ms: 500, timeout_ms: 5000 });
    assert.equal(mutated.click.ok, true, JSON.stringify(mutated));
    assert.ok(mutated.mutations.some((item) => item.added > 0), JSON.stringify(mutated.mutations));
    assert.ok(mutated.network.some((item) => item.url.includes('/probe.json')), JSON.stringify(mutated.network));

    const shot = await handlers.browser_inspect({ action: 'screenshot', selector: '#styled', format: 'png' });
    assert.equal(shot.ok, true, JSON.stringify(shot));
    assert.ok(shot.bytes > 100);
    assert.equal(fs.existsSync(shot.path), true);

    const logs = await handlers.browser_inspect({ action: 'logs', since: 'session', kind: 'exception', limit: 20 });
    assert.ok(logs.entries.some((entry) => /handler blew up/.test(entry.text)), JSON.stringify(logs.entries));

    if (process.env.CODEMINI_BROWSER_MEASURE === '1') {
      console.log(JSON.stringify({
        import_ms: opened.import_ms,
        launch_ms: opened.launch_ms,
        snapshot_chars: snap.summary.length,
        channel: opened.channel,
      }));
    }
  });
});

test('React 18 component source', { skip: !enabled, timeout: 180000 }, async () => {
  const dist = path.join(fixtureRoot, 'react18', 'dist', 'index.html');
  assert.equal(fs.existsSync(dist), true, 'Build fixtures with: node tests/fixtures/browser/build.mjs');
  await withPage(path.join(fixtureRoot, 'react18'), path.join(fixtureRoot, 'react18', 'dist'), async (handlers) => {
    const located = await handlers.browser_inspect({ action: 'locate_source', selector: '#react-throw' });
    assert.equal(located.ok, true, JSON.stringify(located));
    assert.ok(located.locations.some((location) => /Button\.jsx/.test(location.file) && location.framework === 'react'), JSON.stringify(located.locations));
  });
});

test('React 19 component source', { skip: !enabled, timeout: 180000 }, async () => {
  const dist = path.join(fixtureRoot, 'react19', 'dist', 'index.html');
  assert.equal(fs.existsSync(dist), true, 'Build fixtures with: node tests/fixtures/browser/build.mjs');
  await withPage(path.join(fixtureRoot, 'react19'), path.join(fixtureRoot, 'react19', 'dist'), async (handlers) => {
    const located = await handlers.browser_inspect({ action: 'locate_source', selector: '#react-throw' });
    assert.equal(located.ok, true, JSON.stringify(located));
    assert.ok(located.locations.some((location) => /Button\.jsx/.test(location.file) && location.framework === 'react'), JSON.stringify(located.locations));
  });
});

test('Vue 3 component source', { skip: !enabled, timeout: 180000 }, async () => {
  const dist = path.join(fixtureRoot, 'vue3', 'dist', 'index.html');
  assert.equal(fs.existsSync(dist), true, 'Build fixtures with: node tests/fixtures/browser/build.mjs');
  await withPage(path.join(fixtureRoot, 'vue3'), path.join(fixtureRoot, 'vue3', 'dist'), async (handlers) => {
    const located = await handlers.browser_inspect({ action: 'locate_source', selector: '#vue-throw' });
    assert.equal(located.ok, true, JSON.stringify(located));
    assert.ok(located.locations.some((location) => /Button\.vue/.test(location.file) && location.framework === 'vue'), JSON.stringify(located.locations));
  });
});

test('web_fetch renders JavaScript with playwright-core and system Chrome', { skip: !enabled, timeout: 180000 }, async () => {
  const html = `<!doctype html><html><head><title>Rendered</title></head><body><div id="app"></div><script>document.getElementById('app').textContent=${JSON.stringify(`RENDERED_TOKEN_12345 ${'x'.repeat(160)}`)};</script></body></html>`;
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
    const result = await webFetchPage({ url, timeout_ms: 30000 }, browserConfig());
    assert.equal(result.metadata.fetch_mode, 'browser', JSON.stringify(result));
    assert.equal(result.metadata.browser_engine, 'playwright-core');
    assert.match(result.text, /RENDERED_TOKEN_12345/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
