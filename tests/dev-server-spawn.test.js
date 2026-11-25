import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { resolveSpawnInvocation, spawnProjectCommand } from '../src/core/browser/dev-server.js';

test('Windows resolves npm, pnpm, and yarn to their .cmd files without a shell', () => {
  const files = new Set([
    path.win32.join('C:\\nodejs', 'npm.cmd'),
    path.win32.join('C:\\nodejs', 'pnpm.cmd'),
    path.win32.join('C:\\nodejs', 'yarn.cmd'),
  ]);
  const options = {
    platform: 'win32',
    pathEnv: 'C:\\nodejs',
    pathExt: '.EXE;.CMD;.BAT',
    pathDelimiter: ';',
    exists: (file) => [...files].some((item) => item.toLowerCase() === String(file).toLowerCase()),
  };

  const npm = resolveSpawnInvocation(['npm', 'run', 'start'], options);
  assert.equal(npm.file.toLowerCase(), path.win32.join('C:\\nodejs', 'npm.cmd').toLowerCase());
  assert.deepEqual(npm.args, ['run', 'start']);
  assert.equal(npm.shell, false);

  const pnpm = resolveSpawnInvocation(['pnpm', 'run', 'dev'], options);
  assert.equal(pnpm.file.toLowerCase(), path.win32.join('C:\\nodejs', 'pnpm.cmd').toLowerCase());
  assert.equal(pnpm.shell, false);

  const yarn = resolveSpawnInvocation(['yarn', 'dev'], options);
  assert.equal(yarn.file.toLowerCase(), path.win32.join('C:\\nodejs', 'yarn.cmd').toLowerCase());
  assert.deepEqual(yarn.args, ['dev']);
  assert.equal(yarn.shell, false);
});

test('Windows falls back to a shell when the .cmd file cannot be found', () => {
  const result = resolveSpawnInvocation(['pnpm', 'run', 'dev'], {
    platform: 'win32',
    pathEnv: 'C:\\nodejs',
    pathExt: '.EXE;.CMD',
    pathDelimiter: ';',
    exists: () => false,
  });
  assert.equal(result.file, 'pnpm');
  assert.deepEqual(result.args, ['run', 'dev']);
  assert.equal(result.shell, true);
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
