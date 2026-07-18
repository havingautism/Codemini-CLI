import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

import { getSqliteStorageInfo, openSqliteStorageFolder } from '../src/core/storage-info.js';

test('storage info reports global and project SQLite paths with WAL sizes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-storage-info-'));
  const globalDir = path.join(root, 'global');
  const projectDir = path.join(root, 'project');
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = globalDir;
  try {
    const globalPath = path.join(globalDir, 'codemini.sqlite');
    const projectPath = path.join(projectDir, '.codemini', 'index.sqlite');
    await fs.mkdir(path.dirname(globalPath), { recursive: true });
    await fs.mkdir(path.dirname(projectPath), { recursive: true });
    await fs.writeFile(globalPath, Buffer.alloc(100));
    await fs.writeFile(`${globalPath}-wal`, Buffer.alloc(25));
    await fs.writeFile(projectPath, Buffer.alloc(80));
    await fs.writeFile(`${projectPath}-shm`, Buffer.alloc(20));

    const result = await getSqliteStorageInfo(projectDir);
    assert.equal(result.global.path, globalPath);
    assert.equal(result.global.databaseBytes, 100);
    assert.equal(result.global.sizeBytes, 125);
    assert.equal(result.project.path, projectPath);
    assert.equal(result.project.projectDir, path.resolve(projectDir));
    assert.equal(result.project.sizeBytes, 100);
  } finally {
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('opening storage on Windows launches a visible Explorer window', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-storage-open-'));
  const launches = [];
  const spawnProcess = (command, args, options) => {
    launches.push({ command, args, options });
    const child = new EventEmitter();
    child.unref = () => {};
    queueMicrotask(() => child.emit('spawn'));
    return child;
  };

  try {
    await openSqliteStorageFolder('project', root, { spawnProcess, platform: 'win32' });
    assert.equal(launches.length, 1);
    assert.equal(launches[0].command, 'explorer.exe');
    assert.deepEqual(launches[0].args, [`/e,"${path.join(root, '.codemini')}"`]);
    assert.equal(launches[0].options.windowsVerbatimArguments, true);
    assert.equal(launches[0].options.windowsHide, false);
    assert.equal(launches[0].options.detached, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('opening storage on macOS delegates the folder to Finder via open', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-storage-open-mac-'));
  const launches = [];
  const spawnProcess = (command, args, options) => {
    launches.push({ command, args, options });
    const child = new EventEmitter();
    child.unref = () => {};
    queueMicrotask(() => child.emit('spawn'));
    return child;
  };

  try {
    await openSqliteStorageFolder('project', root, { spawnProcess, platform: 'darwin' });
    assert.equal(launches.length, 1);
    assert.equal(launches[0].command, 'open');
    assert.deepEqual(launches[0].args, [path.join(root, '.codemini')]);
    assert.equal(launches[0].options.detached, true);
    assert.equal('windowsVerbatimArguments' in launches[0].options, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
