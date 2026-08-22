import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildHostVerificationCommand } from '../src/core/host-verification.js';
import {
  getBuiltinTools,
  markHostVerificationApproved,
} from '../src/core/tools.js';

test('host verification accepts common build and test runners without a raw shell', () => {
  const accepted = [
    ['npm', ['run', 'build:web']],
    ['node', ['--test', 'tests/example.test.js']],
    ['python', ['-m', 'pytest']],
    ['pytest', ['tests']],
    ['uv', ['run', 'pytest', 'tests']],
    ['cargo', ['test']],
    ['go', ['test', './...']],
    ['dotnet', ['test']],
    ['mvn', ['verify']],
    ['gradlew', ['test']],
    ['cmake', ['--build', 'build']],
    ['ctest', ['--test-dir', 'build']],
  ];

  for (const [program, args] of accepted) {
    assert.doesNotThrow(() => buildHostVerificationCommand({ program, args }));
  }
});

test('host verification rejects installers, arbitrary code, and deployment commands', () => {
  const rejected = [
    ['npm', ['install']],
    ['node', ['-e', 'process.exit(0)']],
    ['python', ['-c', 'print(1)']],
    ['cargo', ['run']],
    ['go', ['run', '.']],
    ['dotnet', ['run']],
    ['mvn', ['deploy']],
    ['gradlew', ['publish']],
    ['cmake', ['-P', 'script.cmake']],
  ];

  for (const [program, args] of rejected) {
    assert.throws(
      () => buildHostVerificationCommand({ program, args }),
      /not an allowed host verification command/i,
      `${program} ${args.join(' ')}`,
    );
  }
});

test('host verification quotes every PowerShell argument literally', () => {
  assert.equal(
    buildHostVerificationCommand({
      program: 'pytest',
      args: ['tests/a b.py', `-k=x'; Remove-Item -Recurse C:\\`],
    }).command,
    `& 'pytest' 'tests/a b.py' '-k=x''; Remove-Item -Recurse C:\\'`,
  );
});

test('host verification resolves Windows project wrappers from cwd', () => {
  assert.equal(
    buildHostVerificationCommand({ program: 'gradlew', args: ['test'] }).command,
    `& '.\\gradlew.bat' 'test'`,
  );
  assert.equal(
    buildHostVerificationCommand({ program: 'mvnw', args: ['verify'] }).command,
    `& '.\\mvnw.cmd' 'verify'`,
  );
});

test('host verification handler refuses calls without the approval marker', async () => {
  const bundle = getBuiltinTools({
    workspaceRoot: process.cwd(),
    config: {
      sandbox: { enabled: true, mode: 'workspace-write', backend: 'microsandbox' },
    },
    platform: 'win32',
  });
  await assert.rejects(
    bundle.handlers.run_host_verification({
      program: 'npm',
      args: ['test'],
    }),
    /requires explicit user approval/i,
  );
});

test('approved host verification runs npm on Windows outside Microsandbox', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows host verification');
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-host-verify-'));
  await fs.writeFile(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({ scripts: { test: 'node --check check.js' } }),
    'utf8',
  );
  await fs.writeFile(path.join(workspaceRoot, 'check.js'), 'const ok = true;\n', 'utf8');
  const bundle = getBuiltinTools({
    workspaceRoot,
    config: {
      policy: { allowed_paths: [] },
      shell: { default: 'bash', timeout_ms: 15_000 },
      sandbox: { enabled: true, mode: 'workspace-write', backend: 'microsandbox' },
    },
    platform: 'win32',
  });
  try {
    const result = await bundle.handlers.run_host_verification(
      markHostVerificationApproved({
        program: 'npm',
        args: ['test'],
      }),
      {},
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.sandbox.bypassed, true);
    assert.equal(result.shell, 'powershell');
  } finally {
    await bundle.dispose?.();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
