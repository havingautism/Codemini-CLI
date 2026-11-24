import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  chooseFrontendProbe,
  chooseStartEntry,
  DEV_SERVER_USER_HINT,
  ensureDevServer,
  extractLoginOpenUrls,
  extractUrlsFromOutput,
  findReusableDevServer,
  isAppLoginOpenUrl,
  isLikelyAuthPage,
  isViableStartEntry,
  listProjectDevEntries,
  looksLikeDevResponse,
  looksLikeNonHttpEntrypoint,
  packageManagerCommand,
  pickLoginOpenUrl,
} from '../src/core/browser/dev-server.js';

function viteHtml() {
  return '<!doctype html><html><head><title>Vite App</title></head><body><script type="module" src="/@vite/client"></script><div id="root"></div></body></html>';
}

function realisticRsbuildHtml() {
  return [
    '<!doctype html>',
    '<html>',
    '<head><title>Scrapbook</title></head>',
    '<body>',
    '<div id="root"></div>',
    '<script defer src="/static/js/lib-react.js"></script>',
    '<script defer src="/static/js/vendors-node_modules_rspack_core_dist_cssExtractHmr_js-3d4f21.js"></script>',
    '<script defer src="/static/js/index.js"></script>',
    '</body>',
    '</html>',
  ].join('');
}

function plainAppHtml() {
  return '<!doctype html><html><head><title>Scrapbook</title></head><body><div id="root"></div><script defer src="/static/js/lib-react.js"></script><script defer src="/static/js/index.js"></script></body></html>';
}

function jsWithSourcemap(name) {
  return `console.log(${JSON.stringify(name)});\n//# sourceMappingURL=${name}.map\n`;
}

function startProbeServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port, url: `http://127.0.0.1:${port}/` });
    });
  });
}

function send(res, { status = 200, headers = {}, body = '' }) {
  res.writeHead(status, headers);
  res.end(body);
}

function serveRsbuildApp(kind = 'realistic') {
  const html = kind === 'sourcemap-only' ? plainAppHtml() : realisticRsbuildHtml();
  return (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return send(res, { headers: { 'content-type': 'text/html; charset=utf-8' }, body: html });
    }
    if (url.pathname === '/static/js/lib-react.js') {
      return send(res, { headers: { 'content-type': 'application/javascript' }, body: jsWithSourcemap('lib-react.js') });
    }
    if (url.pathname.startsWith('/static/js/vendors-node_modules_rspack')) {
      return send(res, { headers: { 'content-type': 'application/javascript' }, body: jsWithSourcemap(path.basename(url.pathname)) });
    }
    if (url.pathname === '/static/js/index.js') {
      const prefix = 'x'.repeat(5000);
      return send(res, { headers: { 'content-type': 'application/javascript' }, body: `${prefix}\n${jsWithSourcemap('index.js')}` });
    }
    send(res, { status: 404, body: 'not found' });
  };
}

async function withTempDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codemini-vf-'));
  try {
    return await run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('AirPlay-like 403 and plain HTML are not reusable dev servers', () => {
  assert.equal(looksLikeDevResponse({
    status: 403,
    url: 'http://127.0.0.1:5000/',
    headers: { server: 'AirTunes/770.11.1', 'content-type': 'text/html' },
    body: '<html><body>AirPlay</body></html>',
  }), false);
  assert.equal(looksLikeDevResponse({
    status: 200,
    url: 'http://127.0.0.1:5000/',
    headers: { 'content-type': 'text/html' },
    body: '<!doctype html><html><body>Hello</body></html>',
  }), false);
  assert.equal(looksLikeDevResponse({
    status: 200,
    url: 'http://127.0.0.1:8787/health',
    headers: { 'content-type': 'application/json' },
    body: '{"ok":true}',
  }), false);
});

test('Vite HTML and realistic rsbuild script filenames can be reused', () => {
  assert.equal(looksLikeDevResponse({
    status: 200,
    url: 'http://127.0.0.1:5173/',
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: viteHtml(),
  }), true);
  assert.equal(looksLikeDevResponse({
    status: 200,
    url: 'http://127.0.0.1:3000/',
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: realisticRsbuildHtml(),
  }), true);
  assert.equal(looksLikeDevResponse({
    status: 200,
    url: 'http://127.0.0.1:3000/',
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: plainAppHtml(),
  }), false);
});

test('a typed AirPlay or signal-less URL is not reused', async () => {
  await withTempDir(async (emptyRoot) => {
  const airplay = await startProbeServer((req, res) => send(res, {
    status: 403,
    headers: { server: 'AirTunes/770.11.1', 'content-type': 'text/html' },
    body: '<html><body>AirPlay</body></html>',
  }));
  const plain = await startProbeServer((req, res) => send(res, {
    status: 200,
    headers: { 'content-type': 'text/html' },
    body: '<!doctype html><html><body>Hello</body></html>',
  }));
  try {
    const rejected = await findReusableDevServer({ preferredUrl: airplay.url, workspaceRoot: emptyRoot });
    assert.equal(rejected?.url || '', '');
    assert.equal(rejected?.preferredRejected, true);
    const alsoRejected = await findReusableDevServer({ preferredUrl: plain.url, workspaceRoot: emptyRoot });
    assert.equal(alsoRejected?.url || '', '');
    await assert.rejects(
      () => ensureDevServer({ preferredUrl: airplay.url, workspaceRoot: emptyRoot, startIfMissing: false }),
      (error) => {
        assert.equal(error.code, 'DEV_SERVER_NOT_FOUND');
        assert.match(error.message, /does not look like a frontend development server/);
        assert.doesNotMatch(error.message, /Start your project's development server/);
        assert.match(error.hint, /Start your project's development server/);
        return true;
      },
    );
  } finally {
    await new Promise((resolve) => airplay.server.close(resolve));
    await new Promise((resolve) => plain.server.close(resolve));
  }
  });
});

test('a Vite or realistic rsbuild preferred URL can be reused', async () => {
  await withTempDir(async (emptyRoot) => {
  const vite = await startProbeServer((req, res) => send(res, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: viteHtml(),
  }));
  const rsbuild = await startProbeServer(serveRsbuildApp('realistic'));
  try {
    const reusedVite = await findReusableDevServer({ preferredUrl: vite.url, workspaceRoot: emptyRoot });
    assert.equal(reusedVite.reused, true);
    assert.equal(reusedVite.url.replace(/\/$/, ''), vite.url.replace(/\/$/, ''));
    const reusedRsbuild = await findReusableDevServer({ preferredUrl: rsbuild.url, workspaceRoot: emptyRoot });
    assert.equal(reusedRsbuild.reused, true);
    assert.equal(reusedRsbuild.url.replace(/\/$/, ''), rsbuild.url.replace(/\/$/, ''));
  } finally {
    await new Promise((resolve) => vite.server.close(resolve));
    await new Promise((resolve) => rsbuild.server.close(resolve));
  }
  });
});

test('an app HTML page is reused when same-origin scripts carry sourcemaps', async () => {
  await withTempDir(async (emptyRoot) => {
    const hosted = await startProbeServer(serveRsbuildApp('sourcemap-only'));
    try {
      assert.equal(looksLikeDevResponse({
        status: 200,
        url: hosted.url,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: plainAppHtml(),
      }), false);
      const reused = await findReusableDevServer({ preferredUrl: hosted.url, workspaceRoot: emptyRoot });
      assert.equal(reused.reused, true);
      assert.equal(reused.url.replace(/\/$/, ''), hosted.url.replace(/\/$/, ''));
      assert.equal(reused.probe?.ok, true);
    } finally {
      await new Promise((resolve) => hosted.server.close(resolve));
    }
  });
});

test('discovery finds a nested rsbuild frontend when the root script is only npm run dev', async () => {
  await withTempDir(async (dir) => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: 'app',
      private: true,
      scripts: { dev: 'concurrently "npm run dev --prefix frontend" "npm run start --prefix backend"' },
    }, null, 2));
    fs.mkdirSync(path.join(dir, 'frontend'));
    fs.mkdirSync(path.join(dir, 'backend'));
    fs.writeFileSync(path.join(dir, 'frontend', 'package.json'), JSON.stringify({
      name: 'frontend',
      scripts: { dev: 'rsbuild dev' },
    }, null, 2));
    fs.writeFileSync(path.join(dir, 'backend', 'package.json'), JSON.stringify({
      name: 'backend',
      scripts: { start: 'node server.js' },
    }, null, 2));
    const entries = listProjectDevEntries(dir);
    const rootDev = entries.find((entry) => entry.root && entry.name === 'dev');
    const frontendDev = entries.find((entry) => entry.cwd === path.join(dir, 'frontend') && entry.name === 'dev');
    assert.ok(rootDev, 'root npm run dev should remain the start entry');
    assert.equal(rootDev.commandText.includes('dev'), true);
    assert.ok(frontendDev, 'nested rsbuild package should be discovered');
    assert.equal(frontendDev.frontend, true);
    assert.deepEqual(frontendDev.ports, [3000, 3001]);
    assert.equal(frontendDev.ports.includes(5000), false);
    const hosted = await startProbeServer(serveRsbuildApp('realistic'));
    try {
      fs.writeFileSync(path.join(dir, 'frontend', 'package.json'), JSON.stringify({
        name: 'frontend',
        scripts: { dev: `rsbuild dev --port ${hosted.port}` },
      }, null, 2));
      const found = await findReusableDevServer({ workspaceRoot: dir });
      assert.ok(found?.url, 'qualified nested frontend should be reusable');
      assert.equal(found.reused, true);
      assert.equal(new URL(found.url).port, String(hosted.port));
    } finally {
      await new Promise((resolve) => hosted.server.close(resolve));
    }
  });
});

test('startup URL selection prefers a frontend log URL over a backend port', () => {
  const urls = extractUrlsFromOutput('API listening at http://127.0.0.1:8787/\n  ➜  rsbuild Local: http://127.0.0.1:3000/');
  assert.deepEqual(urls.map((item) => item.url.replace(/\/$/, '')), [
    'http://127.0.0.1:8787',
    'http://127.0.0.1:3000',
  ]);
  assert.equal(urls[1].hint, 'frontend-log');
  const chosen = chooseFrontendProbe([
    {
      url: 'http://127.0.0.1:8787/',
      hint: 'log',
      probe: { status: 200, url: 'http://127.0.0.1:8787/', headers: { 'content-type': 'application/json' }, body: '{"ok":true}' },
    },
    {
      url: 'http://127.0.0.1:3000/',
      hint: 'frontend-log',
      preferredPorts: [3000],
      probe: { status: 200, url: 'http://127.0.0.1:3000/', headers: { 'content-type': 'text/html' }, body: realisticRsbuildHtml(), ok: true },
    },
  ]);
  assert.equal(chosen.url, 'http://127.0.0.1:3000/');
  assert.match(DEV_SERVER_USER_HINT, /typed URL is not enough/);
});

test('a nested project with package-lock.json is not hijacked by an ancestor pnpm-lock.yaml', async () => {
  await withTempDir(async (homeish) => {
    fs.writeFileSync(path.join(homeish, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
    const project = path.join(homeish, 'Desktop', 'Scrapbook_copy');
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({
      name: 'scrapbook',
      scripts: { dev: 'concurrently "npm run dev --prefix frontend" "npm run start --prefix backend"' },
    }, null, 2));
    fs.writeFileSync(path.join(project, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3 }));
    const frontend = path.join(project, 'frontend');
    fs.mkdirSync(frontend);
    fs.writeFileSync(path.join(frontend, 'package.json'), JSON.stringify({
      name: 'frontend',
      scripts: { dev: 'rsbuild dev' },
    }, null, 2));

    assert.equal(packageManagerCommand(project).bin, 'npm');
    assert.equal(packageManagerCommand(frontend).bin, 'npm');
    assert.equal(packageManagerCommand(frontend, { boundary: project }).bin, 'npm');

    const entries = listProjectDevEntries(project);
    const rootDev = entries.find((entry) => entry.root && entry.name === 'dev');
    const frontendDev = entries.find((entry) => entry.cwd === frontend && entry.name === 'dev');
    assert.ok(rootDev.command[0] === 'npm', 'root start should use npm');
    assert.match(rootDev.commandText, /^npm run dev$/);
    assert.ok(frontendDev.command[0] === 'npm', 'nested package should use npm, not ancestor pnpm');
    assert.match(frontendDev.commandText, /^npm run dev$/);
  });
});


function writePkg(dir, data) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(data, null, 2));
}

test('root CLI start plus a nested frontend dev chooses the nested dev script', async () => {
  await withTempDir(async (dir) => {
    writePkg(dir, {
      name: 'app',
      scripts: { start: 'node bin/coder.js' },
    });
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.writeFileSync(path.join(dir, 'bin', 'coder.js'), 'console.log("codemini>");\n');
    writePkg(path.join(dir, 'web'), {
      name: 'web',
      scripts: {
        dev: 'node scripts/dev.js',
        start: 'node server.js',
        build: 'vite build --config vite.config.js',
      },
    });
    const entries = listProjectDevEntries(dir);
    const rootStart = entries.find((entry) => entry.root && entry.name === 'start');
    const webDev = entries.find((entry) => entry.cwd === path.join(dir, 'web') && entry.name === 'dev');
    const webStart = entries.find((entry) => entry.cwd === path.join(dir, 'web') && entry.name === 'start');
    const webBuild = entries.find((entry) => entry.cwd === path.join(dir, 'web') && entry.name === 'build');
    assert.ok(rootStart, 'root start should still be discovered');
    assert.equal(looksLikeNonHttpEntrypoint(rootStart.scriptCommand), true);
    assert.equal(isViableStartEntry(rootStart), false);
    assert.ok(webDev, 'nested web dev should be discovered');
    assert.ok(webStart, 'nested web start should remain as a fallback entry');
    if (webBuild) assert.equal(isViableStartEntry(webBuild), false);
    const chosen = chooseStartEntry(entries);
    assert.equal(chosen.cwd, path.join(dir, 'web'));
    assert.equal(chosen.name, 'dev');
    assert.match(chosen.scriptCommand, /dev\.js/);
  });
});

test('a root start that is not a web server is not chosen', async () => {
  await withTempDir(async (dir) => {
    writePkg(dir, {
      name: 'cli-only',
      scripts: { start: 'node bin/coder.js' },
    });
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.writeFileSync(path.join(dir, 'bin', 'coder.js'), 'console.log("codemini>"); process.exit(0);\n');
    const entries = listProjectDevEntries(dir);
    const rootStart = entries.find((entry) => entry.root && entry.name === 'start');
    assert.ok(rootStart);
    assert.equal(isViableStartEntry(rootStart), false);
    assert.equal(chooseStartEntry(entries), null);
    await assert.rejects(
      () => ensureDevServer({ workspaceRoot: dir, startIfMissing: true, timeoutMs: 2000 }),
      (error) => {
        assert.equal(error.code, 'DEV_SERVER_SCRIPT_MISSING');
        assert.doesNotMatch(error.message, /codemini>/);
        assert.doesNotMatch(error.message, /typed URL is not enough/);
        assert.doesNotMatch(error.message, /exited early/);
        assert.doesNotMatch(error.message, /bin\/coder/);
        return true;
      },
    );
  });
});

test('if the first start entry exits early, the next qualifying entry is tried', async () => {
  await withTempDir(async (dir) => {
    writePkg(dir, {
      name: 'app',
      scripts: { dev: 'node scripts/dev.js' },
    });
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.writeFileSync(path.join(dir, 'scripts', 'dev.js'), 'console.log("root dev exiting"); process.exit(0);\n');
    const web = path.join(dir, 'web');
    writePkg(web, {
      name: 'web',
      scripts: { dev: 'node scripts/dev.js' },
    });
    fs.mkdirSync(path.join(web, 'scripts'));
    fs.writeFileSync(path.join(web, 'scripts', 'dev.js'), `
const http = require('http');
const html = '<!doctype html><html><head><title>Vite App</title></head><body><script type="module" src="/@vite/client"></script><div id="root"></div></body></html>';
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
});
server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  console.log('  ➜  Local: http://127.0.0.1:' + port + '/');
});
`);
    const entries = listProjectDevEntries(dir);
    const chosenFirst = chooseStartEntry(entries);
    assert.equal(chosenFirst.root, true);
    assert.equal(chosenFirst.name, 'dev');
    let started;
    try {
      started = await ensureDevServer({ workspaceRoot: dir, startIfMissing: true, timeoutMs: 8000 });
      assert.equal(started.started, true);
      assert.equal(started.reused, false);
      assert.equal(started.cwd, web);
      assert.equal(started.script, 'dev');
      assert.ok(started.url);
      assert.match(started.url, /^http:\/\/127\.0\.0\.1:\d+/);
    } finally {
      if (started?.child && started.child.exitCode == null) {
        started.child.kill('SIGTERM');
      }
    }
  });
});

test('a running frontend on a non-default port is reused when the dev script omits the bundler name', async () => {
  await withTempDir(async (dir) => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: 'web',
      scripts: { dev: 'node scripts/dev.js' },
    }));
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.writeFileSync(path.join(dir, 'scripts/dev.js'), 'console.log("dev wrapper");\n');
    const hosted = await startProbeServer((req, res) => send(res, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: viteHtml(),
    }));
    try {
      const entries = listProjectDevEntries(dir);
      const dev = entries.find((entry) => entry.name === 'dev');
      assert.ok(dev);
      assert.equal(dev.scriptCommand, 'node scripts/dev.js');
      assert.ok(!/\bvite\b/i.test(dev.scriptCommand));
      assert.ok(!/\bvite\b/i.test(dev.commandText || ''));
      assert.equal((dev.ports || []).includes(hosted.port), false);

      const discovered = await findReusableDevServer({
        workspaceRoot: dir,
        discoverListeners: async () => [{
          pid: process.pid,
          port: hosted.port,
          host: '127.0.0.1',
          cwd: dir,
          command: `node scripts/dev.js --port ${hosted.port}`,
        }],
      });
      assert.equal(discovered?.reused, true);
      assert.equal(discovered.url, hosted.url);
      assert.match(discovered.probe.body, /@vite\/client/);

      const ignored = await findReusableDevServer({
        workspaceRoot: dir,
        discoverListeners: async () => [{
          pid: 1,
          port: hosted.port,
          host: '127.0.0.1',
          cwd: path.join(os.tmpdir(), 'unrelated-project'),
          command: `node scripts/dev.js --port ${hosted.port}`,
        }],
      });
      assert.equal(ignored?.url || '', '');
    } finally {
      hosted.server.close();
    }
  });
});

test('plain HTML on a workspace port is not reused', async () => {
  await withTempDir(async (dir) => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: 'web',
      scripts: { dev: 'node scripts/dev.js' },
    }));
    const hosted = await startProbeServer((req, res) => send(res, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: plainAppHtml(),
    }));
    try {
      const found = await findReusableDevServer({
        workspaceRoot: dir,
        discoverListeners: async () => [{
          pid: process.pid,
          port: hosted.port,
          host: '127.0.0.1',
          cwd: dir,
          command: `node scripts/dev.js --port ${hosted.port}`,
        }],
      });
      assert.equal(found?.url || '', '');
    } finally {
      hosted.server.close();
    }
  });
});

test('a printed one-click login URL is used when present and not invented when absent', () => {
  const openUrl = 'http://127.0.0.1:5180/login#token=abcdef';
  const logs = [
    '  ➜  Local:   http://127.0.0.1:5180/',
    '  Login: ' + openUrl,
    '  Token file: /tmp/web-token',
  ].join('\n');
  assert.equal(isAppLoginOpenUrl(openUrl), true);
  assert.equal(isAppLoginOpenUrl('http://127.0.0.1:5180/'), false);
  assert.equal(isAppLoginOpenUrl('http://127.0.0.1:5180/login'), false);
  assert.deepEqual(extractLoginOpenUrls(logs), [openUrl]);
  assert.equal(pickLoginOpenUrl(logs, { origin: 'http://127.0.0.1:5180/' }), openUrl);
  assert.equal(pickLoginOpenUrl('Local: http://127.0.0.1:5180/\nready.'), '');
  const fromOpenFlag = pickLoginOpenUrl('node scripts/dev.js --open http://127.0.0.1:5178/signin?access_token=abc');
  assert.equal(fromOpenFlag, 'http://127.0.0.1:5178/signin?access_token=abc');
});


test('an auth page is detected from generic login or token URLs, not from ordinary app routes', () => {
  assert.equal(isLikelyAuthPage('http://127.0.0.1:3000/signin'), true);
  assert.equal(isLikelyAuthPage('http://127.0.0.1:3000/auth/oauth'), true);
  assert.equal(isLikelyAuthPage('http://127.0.0.1:3000/app#/sign-in'), true);
  assert.equal(isLikelyAuthPage('http://127.0.0.1:3000/welcome#token=abc'), true);
  assert.equal(isLikelyAuthPage('http://127.0.0.1:3000/chat/session-1'), false);
  assert.equal(isLikelyAuthPage('http://127.0.0.1:3000/author/profile'), false);
  assert.equal(isLikelyAuthPage('http://127.0.0.1:3000/'), false);
  assert.equal(isLikelyAuthPage(''), false);
  assert.equal(isAppLoginOpenUrl('http://127.0.0.1:3000/welcome#token=abc'), true);
  assert.equal(pickLoginOpenUrl('ready on http://127.0.0.1:3000/'), '');
});
