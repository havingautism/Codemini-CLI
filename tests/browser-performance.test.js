import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { getBuiltinTools } from '../src/core/tools.js';

const enabled = process.env.CODEMINI_BROWSER_TESTS === '1';
const page = `<!doctype html><button id="burn">Burn</button><script>
document.getElementById('burn').addEventListener('click', () => {
  const start = performance.now();
  while (performance.now() - start < 80) {}
});
</script>`;

function startServer() {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(page);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/` });
    });
  });
}

test('profiles a busy click in Chromium', { skip: !enabled, timeout: 180000 }, async () => {
  const server = await startServer();
  const bundle = getBuiltinTools({
    workspaceRoot: process.cwd(),
    config: {
      execution: { mode: 'coding' },
      browser: { headless: true, channel: process.env.CODEMINI_BROWSER_CHANNEL || 'auto' },
    },
  });
  try {
    const report = await bundle.handlers.performance_profile({
      url: server.url,
      duration: 1000,
      actions: [{ type: 'click', selector: '#burn' }],
    });
    assert.equal(report.ok, true, JSON.stringify(report));
    assert.equal(report.tool, 'performance_profile');
    assert.equal(typeof report.summary, 'string');
    assert.ok(report.report.summary.duration >= 1000);
    assert.equal(Array.isArray(report.report.longTasks), true);
    assert.equal(Array.isArray(report.report.hotspots), true);
    assert.ok(report.report.summary.longTaskCount > 0 || report.report.hotspots.length > 0);
    assert.equal(report.events, undefined);
    assert.equal(report.profile, undefined);
    await bundle.handlers.browser_act({ action: 'close' });
    const afterClose = await bundle.handlers.performance_profile({});
    assert.equal(afterClose.code, 'BROWSER_NOT_OPEN');
  } finally {
    await bundle.dispose?.();
    await new Promise((resolve) => server.server.close(resolve));
  }
});
