import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { resolveSpawnInvocation, spawnProjectCommand } from '../src/core/browser/dev-server.js';

test('Windows uses cmd.exe for batch shims and skips extensionless Unix shims', () => {
  const installDir = 'C:\\Program Files\\nodejs';
  const files = ['npm', 'npm.cmd', 'pnpm.cmd', 'yarn.cmd', 'node.exe'].map((file) => path.win32.join(installDir, file).toLowerCase());
  const options = {
    platform: 'win32',
    pathEnv: installDir,
    pathExt: '.EXE;.CMD;.BAT',
    pathDelimiter: ';',
    exists: (file) => files.includes(file.toLowerCase()),
  };
  for (const [manager, args] of [['npm', ['run', 'start']], ['pnpm', ['run', 'dev']], ['yarn', ['dev']]]) {
    const invocation = resolveSpawnInvocation([manager, ...args], options);
    assert.equal(path.win32.basename(invocation.file).toLowerCase(), 'cmd.exe');
    assert.deepEqual(invocation.args.slice(0, 4), ['/d', '/v:off', '/s', '/c']);
    assert.equal(invocation.args[4].toLowerCase(), `""${installDir}\\${manager}.CMD" ${args.map((arg) => `"${arg}"`).join(' ')}"`.toLowerCase());
    assert.equal(invocation.shell, false);
    assert.equal(invocation.windowsVerbatimArguments, true);
  }
  assert.deepEqual(resolveSpawnInvocation(['node', 'dev.js'], options), {
    file: path.win32.join(installDir, 'node.EXE'), args: ['dev.js'], shell: false,
  });
  assert.throws(() => resolveSpawnInvocation(['npm', 'run', '%PATH%'], options), { code: 'DEV_SERVER_SPAWN_FAILED' });
});

test('Windows leaves a missing command to fail without shell interpretation', () => {
  const result = resolveSpawnInvocation(['pnpm', 'run', 'dev'], {
    platform: 'win32',
    pathEnv: 'C:\\nodejs',
    pathExt: '.EXE;.CMD',
    pathDelimiter: ';',
    exists: () => false,
  });
  assert.equal(result.file, 'pnpm');
  assert.deepEqual(result.args, ['run', 'dev']);
  assert.equal(result.shell, false);
});

test('non-Windows keeps the original command and does not enable a shell', () => {
  const result = resolveSpawnInvocation(['npm', 'run', 'dev'], {
    platform: 'linux',
    exists: () => false,
  });
  assert.equal(result.file, 'npm');
  assert.deepEqual(result.args, ['run', 'dev']);
  assert.equal(result.shell, false);
});

test('spawnProjectCommand always listens for child errors', () => {
  const child = new EventEmitter();
  const spawned = [];
  const result = spawnProjectCommand(['npm', 'run', 'start'], {
    cwd: '/tmp',
    env: { BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
    platform: 'linux',
    spawnImpl: (file, args, options) => {
      spawned.push({ file, args, options });
      return child;
    },
  });
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].file, 'npm');
  assert.equal(spawned[0].options.shell, false);
  assert.equal(result.error, null);
  const error = Object.assign(new Error('spawn npm ENOENT'), { code: 'ENOENT' });
  child.emit('error', error);
  assert.equal(result.error, error);
  assert.equal(result.error.code, 'ENOENT');
});
