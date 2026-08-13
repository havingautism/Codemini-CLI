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

test('resolveTrustedFffCommand rejects workspace files through a symlinked root', async () => {
  await withTempDir('codemini-fff-symlink-', async (root) => {
    const workspace = path.join(root, 'workspace');
    const linkedWorkspace = path.join(root, 'workspace-link');
    const helper = path.join(workspace, 'helper');
    await fs.mkdir(workspace);
    await fs.writeFile(helper, '#!/bin/sh\n', { mode: 0o755 });
    await fs.symlink(
      workspace,
      linkedWorkspace,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await assert.rejects(
      () => resolveTrustedFffCommand(helper, linkedWorkspace),
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

test('resolveTrustedFffCommand rejects non-executable Unix files', {
  skip: process.platform === 'win32',
}, async () => {
  await withTempDir('codemini-fff-non-executable-', async (root) => {
    const workspace = path.join(root, 'workspace');
    const helper = path.join(root, 'helper');
    await fs.mkdir(workspace);
    await fs.writeFile(helper, '#!/bin/sh\n', { mode: 0o644 });

    await assert.rejects(
      () => resolveTrustedFffCommand(helper, workspace),
      /executable file/,
    );
  });
});

test('resolveTrustedFffCommand rejects directories', async () => {
  await withTempDir('codemini-fff-directory-', async (root) => {
    const workspace = path.join(root, 'workspace');
    const commandDir = path.join(root, 'command-dir');
    await fs.mkdir(workspace);
    await fs.mkdir(commandDir);

    await assert.rejects(
      () => resolveTrustedFffCommand(commandDir, workspace),
      /executable file/,
    );
  });
});

test('FFF connect starts a Windows PATH cmd shim', {
  skip: process.platform !== 'win32',
}, async () => {
  await withTempDir('codemini-fff-cmd-', async (root) => {
    const workspace = path.join(root, 'workspace');
    const binDir = path.join(root, 'bin');
    const server = path.join(binDir, 'mock-fff.mjs');
    const commandName = `codemini-fff-cmd-${process.pid}`;
    const shim = path.join(binDir, `${commandName}.cmd`);
    await fs.mkdir(workspace);
    await fs.mkdir(binDir);
    await fs.writeFile(server, `
let input = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  input = Buffer.concat([input, chunk]);
  const headerEnd = input.indexOf('\\r\\n\\r\\n');
  if (headerEnd < 0) return;
  const match = input.slice(0, headerEnd).toString().match(/Content-Length:\\s*(\\d+)/i);
  if (!match || input.length < headerEnd + 4 + Number(match[1])) return;
  const request = JSON.parse(input.slice(headerEnd + 4, headerEnd + 4 + Number(match[1])));
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {} }));
  process.stdout.write(\`Content-Length: \${body.length}\\r\\n\\r\\n\`);
  process.stdout.write(body);
});
`);
    await fs.writeFile(shim, '@echo off\r\nnode "%~dp0mock-fff.mjs"\r\n');

    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${previousPath || ''}`;
    const adapter = createFffAdapter({
      workspaceRoot: workspace,
      config: { search: { fff_command: commandName } },
    });
    try {
      await adapter.connect();
    } finally {
      await adapter.dispose();
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
