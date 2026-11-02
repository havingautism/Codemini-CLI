import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildLoginUrl as webLoginUrl } from '../codemini-web/lib/web-security.js';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plan = require('../desktop/runtime-plan.cjs');
const builder = require('../desktop/electron-builder.config.cjs');
const pkg = require('../package.json');

test('desktop login url matches the web UI login hash', () => {
  const origin = 'http://127.0.0.1:3210';
  const token = 'a'.repeat(64);
  assert.equal(plan.buildLoginUrl(origin, token), webLoginUrl(origin, token));
  assert.match(plan.buildLoginUrl(origin, token), /^http:\/\/127\.0\.0\.1:3210\/login#token=/);
});

test('desktop server stays on loopback and does not open a browser', () => {
  assert.deepEqual(plan.buildServerArgs({ port: 3210 }), ['--port', '3210', '--host', '127.0.0.1', '--no-open']);
  assert.deepEqual(
    plan.buildServerArgs({ port: 4000, project: '  C:\\work\\app  ' }),
    ['--port', '4000', '--host', '127.0.0.1', '--no-open', '--project', 'C:\\work\\app'],
  );
  assert.equal(plan.readProjectArg(['Codemini.exe', '--project', 'D:\\repo']), 'D:\\repo');
  assert.equal(plan.readProjectArg(['Codemini.exe', '--project']), '');
});

test('desktop navigation stays on the local web UI', () => {
  assert.equal(plan.isLocalAppUrl('http://127.0.0.1:3210/'), true);
  assert.equal(plan.isLocalAppUrl('http://localhost:3210/login'), true);
  assert.equal(plan.isLocalAppUrl('https://127.0.0.1:3210/'), false);
  assert.equal(plan.isLocalAppUrl('http://example.com/'), false);
  assert.equal(plan.isLocalAppUrl('not a url'), false);
});

test('packaged and dev app roots point at the server entry', () => {
  assert.equal(plan.resolveAppRoot({ isPackaged: true, appPath: '/app.asar', moduleDir: '/app.asar/desktop' }), '/app.asar');
  assert.equal(
    plan.resolveServerEntry(plan.resolveAppRoot({ isPackaged: false, appPath: '', moduleDir: path.join(root, 'desktop') })),
    path.join(root, 'codemini-web', 'server.js'),
  );
  assert.equal(plan.resolveWebIndex(root), path.join(root, 'codemini-web', 'dist', 'index.html'));
});

test('findFreePort returns a loopback port', async () => {
  const port = await plan.findFreePort();
  assert.equal(typeof port, 'number');
  assert.ok(port > 0 && port < 65536);
});

test('electron-builder config ships unsigned win and mac artifacts', () => {
  assert.equal(builder.forceCodeSigning, false);
  assert.equal(builder.appId, 'dev.codemini.desktop');
  assert.deepEqual(builder.mac.target, ['dmg', 'zip']);
  assert.deepEqual(builder.win.target, ['nsis', 'zip']);
  assert.equal(builder.mac.sign, undefined);
  assert.equal(builder.directories.output, 'desktop-dist');
  assert.ok(builder.files.includes('codemini-web/dist/**/*'));
  assert.ok(builder.files.includes('codemini-web/server.js'));
  assert.equal(pkg.version, '0.10.0');
  assert.equal(pkg.main, 'desktop/main.cjs');
  assert.equal(pkg.devDependencies.electron, '45.2.1');
  assert.equal(pkg.devDependencies['electron-builder'], '26.18.0');
  assert.equal(pkg.scripts['desktop:dist:win'], 'electron-builder --config desktop/electron-builder.config.cjs --win --x64');
  assert.equal(pkg.scripts['desktop:dist:mac'], 'electron-builder --config desktop/electron-builder.config.cjs --mac');
});

test('release tag check follows package.json', () => {
  const script = path.join(root, 'scripts', 'check-release-tag.js');
  const match = spawnSync(process.execPath, [script, `v${pkg.version}`], { encoding: 'utf8' });
  assert.equal(match.status, 0, match.stderr);
  const mismatch = spawnSync(process.execPath, [script, 'v0.0.0-not-a-release'], { encoding: 'utf8' });
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, /does not match/);
});

test('release workflows stay manual for npm and attach desktop artifacts', () => {
  const desktop = fs.readFileSync(path.join(root, '.github/workflows/desktop-release.yml'), 'utf8');
  const publish = fs.readFileSync(path.join(root, '.github/workflows/npm-publish.yml'), 'utf8');
  assert.match(desktop, /windows-latest/);
  assert.match(desktop, /macos-latest/);
  assert.match(desktop, /CSC_IDENTITY_AUTO_DISCOVERY: "false"/);
  assert.match(desktop, /softprops\/action-gh-release@v2/);
  assert.match(desktop, /check-release-tag\.js/);
  assert.match(publish, /workflow_dispatch:/);
  assert.match(publish, /secrets\.NPM_TOKEN/);
  assert.doesNotMatch(publish, /push:\s*\n\s*tags:/);
  assert.equal(fs.existsSync(path.join(root, 'design-qa.md')), false);
  assert.equal(fs.existsSync(path.join(root, 'codemini-memory-2.1-design.md')), false);
});
