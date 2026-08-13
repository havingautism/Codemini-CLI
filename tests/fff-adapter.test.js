import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createFffAdapter, resolveTrustedFffCommand } from '../src/core/fff-adapter.js';

async function withTempDir(prefix, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

function markerScript(markerPath) {
  return `#!/usr/bin/env node
import fs from 'node:fs';
fs.writeFileSync(${JSON.stringify(markerPath)}, 'ran');
`;
}

test('resolveTrustedFffCommand rejects relative and workspace paths', async () => {
  await withTempDir('codemini-fff-untrusted-', async (workspace) => {
    const helper = path.join(workspace, '.codemini-global', 'helper.mjs');
    await fs.mkdir(path.dirname(helper), { recursive: true });
    await fs.writeFile(helper, 'export {}\n');

    await assert.rejects(
      () => resolveTrustedFffCommand('./.codemini-global/helper.mjs', workspace),
      /PATH program name|absolute path outside the workspace/,
    );
    await assert.rejects(
      () => resolveTrustedFffCommand(helper, workspace),
      /workspace file/,
    );
  });
});

test('resolveTrustedFffCommand accepts a PATH program outside the workspace', async () => {
  await withTempDir('codemini-fff-path-', async (root) => {
    const workspace = path.join(root, 'workspace');
    const binDir = path.join(root, 'bin');
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    const commandName = `codemini-fff-safe-${process.pid}`;
    const binary = path.join(
      binDir,
      process.platform === 'win32' ? `${commandName}.cmd` : commandName,
    );
    await fs.writeFile(binary, process.platform === 'win32' ? '@echo off\n' : '#!/bin/sh\n');
    if (process.platform !== 'win32') await fs.chmod(binary, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${previousPath || ''}`;
    try {
      const resolved = await resolveTrustedFffCommand(commandName, workspace);
      assert.equal(await fs.realpath(resolved), await fs.realpath(binary));
    } finally {
      process.env.PATH = previousPath;
    }
  });
});

test('resolveTrustedFffCommand ignores a workspace binary that shadows PATH', async () => {
  await withTempDir('codemini-fff-shadow-', async (root) => {
    const workspace = path.join(root, 'workspace');
    await fs.mkdir(workspace, { recursive: true });
    const commandName = `codemini-fff-shadow-${process.pid}`;
    const decoy = path.join(
      workspace,
      process.platform === 'win32' ? `${commandName}.cmd` : commandName,
    );
    await fs.writeFile(decoy, process.platform === 'win32' ? '@echo off\n' : '#!/bin/sh\n');
    if (process.platform !== 'win32') await fs.chmod(decoy, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${workspace}${path.delimiter}${previousPath || ''}`;
    try {
      await assert.rejects(
        () => resolveTrustedFffCommand(commandName, workspace),
        /not found on PATH/,
      );
    } finally {
      process.env.PATH = previousPath;
    }
  });
});

test('FFF connect does not spawn a workspace-configured command', async () => {
  await withTempDir('codemini-fff-spawn-', async (workspace) => {
    const helper = path.join(workspace, '.codemini-global', 'helper.mjs');
    const marker = path.join(workspace, '.codemini-global', 'marker.txt');
    await fs.mkdir(path.dirname(helper), { recursive: true });
    await fs.writeFile(helper, markerScript(marker), { mode: 0o755 });

    const adapter = createFffAdapter({
      workspaceRoot: workspace,
      config: { search: { fff_command: './.codemini-global/helper.mjs' } },
    });
    await assert.rejects(() => adapter.connect());
    await adapter.dispose();
    await assert.rejects(() => fs.readFile(marker, 'utf8'), { code: 'ENOENT' });
  });
});
