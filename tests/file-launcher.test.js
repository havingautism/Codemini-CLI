import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  fileLaunchCommand,
  launchWorkspacePath,
} from '../src/core/file-launcher.js';

test('file launch commands open and reveal files with platform-native behavior', () => {
  assert.deepEqual(
    fileLaunchCommand('/tmp/spec.md', { action: 'reveal', platform: 'darwin' }),
    { command: 'open', args: ['-R', '/tmp/spec.md'], options: {} },
  );
  assert.deepEqual(
    fileLaunchCommand('/tmp/spec.md', { action: 'reveal', platform: 'linux' }),
    { command: 'xdg-open', args: ['/tmp'], options: {} },
  );
  const windows = fileLaunchCommand('C:\\repo\\spec.md', {
    action: 'open',
    platform: 'win32',
  });
  assert.equal(windows.command, 'powershell.exe');
  assert.equal(windows.options.env.CODEMINI_OPEN_TARGET, 'C:\\repo\\spec.md');
});

test('launchWorkspacePath resolves project-relative files and starts one launcher', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-open-'));
  const target = path.join(workspace, 'spec.md');
  await fs.writeFile(target, '# Spec');
  const calls = [];
  const spawnProcess = (command, args, options) => {
    calls.push({ command, args, options });
    return {
      once(event, callback) {
        if (event === 'spawn') queueMicrotask(callback);
        return this;
      },
      unref() {},
    };
  };

  const result = await launchWorkspacePath('spec.md', workspace, {
    action: 'reveal',
    platform: 'linux',
    spawnProcess,
  });

  assert.equal(result.ok, true);
  assert.equal(result.path, await fs.realpath(target));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, [await fs.realpath(workspace)]);
});

test('launchWorkspacePath rejects paths outside the current project', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-open-'));
  await assert.rejects(
    launchWorkspacePath('../outside.md', workspace),
    /outside the current project/,
  );
});
