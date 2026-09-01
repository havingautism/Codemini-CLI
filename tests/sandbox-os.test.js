import test from 'node:test';
import assert from 'node:assert/strict';
import {
  __setSandboxOsTestHooks,
  wrapShellCommandForSandbox,
} from '../src/core/sandbox-os.js';
import { SandboxUnavailableError } from '../src/core/sandbox-runtime.js';
import { resolveSandboxShell } from '../src/core/shell.js';

test('Unix sandbox uses pwsh for a PowerShell-configured shell', () => {
  assert.equal(resolveSandboxShell('powershell'), 'pwsh');
  assert.equal(resolveSandboxShell('bash'), 'bash');
});

test('wrapShellCommandForSandbox skips on win32', async () => {
  __setSandboxOsTestHooks({
    SandboxManager: {
      async initialize() {},
      isSandboxingEnabled: () => true,
      isSupportedPlatform: () => true,
      async wrapWithSandbox() {
        throw new Error('should not wrap on win32');
      },
    },
  });
  try {
    const out = await wrapShellCommandForSandbox({
      command: 'echo hi',
      config: { sandbox: { enabled: 'auto', mode: 'workspace-write' } },
      cwd: process.cwd(),
      platform: 'win32',
    });
    assert.equal(out.wrapped, false);
    assert.equal(out.command, 'echo hi');
  } finally {
    __setSandboxOsTestHooks(null);
  }
});

test('workspace-write sandbox uses the npm Landlock launcher and leaves network unrestricted', async () => {
  let grants = null;
  __setSandboxOsTestHooks({
    Landlock: {
      launcherPath: () => '/npm/bin/landlock-run',
      probe: () => 'full',
      grantArgs(value) {
        grants = value;
        return ['--grant-test'];
      },
    },
  });
  try {
    const out = await wrapShellCommandForSandbox({
      command: 'echo hi',
      config: { sandbox: { enabled: true, mode: 'workspace-write' } },
      cwd: '/tmp/project',
      platform: 'linux',
      binShell: 'bash',
    });
    assert.equal(out.wrapped, true);
    assert.equal(out.executable, '/npm/bin/landlock-run');
    assert.deepEqual(out.args, ['--grant-test', '--', 'bash', '-lc', 'echo hi']);
    assert.deepEqual(grants.readOnly, ['/']);
    assert.ok(grants.readWrite.includes(out.policy.workspaceRoot));
    assert.equal(out.enforcement, 'full');
  } finally {
    __setSandboxOsTestHooks(null);
  }
});

test('Landlock workspace-write grants tower git commit dirs but not the parent checkout', async () => {
  let grants = null;
  __setSandboxOsTestHooks({
    Landlock: {
      launcherPath: () => '/npm/bin/landlock-run',
      probe: () => 'full',
      grantArgs(value) {
        grants = value;
        return ['--grant-test'];
      },
    },
  });
  try {
    const parent = '/tmp/codemini-landlock-tower-parent';
    const worktree = `${parent}/.codemini/tower/worktrees/alisa`;
    const out = await wrapShellCommandForSandbox({
      command: 'git commit -m sealed',
      config: { sandbox: { enabled: true, mode: 'workspace-write' } },
      cwd: worktree,
      platform: 'linux',
      binShell: 'bash',
    });
    assert.equal(out.wrapped, true);
    assert.ok(grants.readWrite.includes(out.policy.workspaceRoot));
    assert.ok(grants.readWrite.includes(`${parent}/.git/objects`));
    assert.ok(grants.readWrite.includes(`${parent}/.git/worktrees/alisa`));
    assert.equal(grants.readWrite.includes(parent), false);
    assert.equal(grants.readWrite.includes(`${parent}/.git/hooks`), false);
  } finally {
    __setSandboxOsTestHooks(null);
  }
});

test('read-only Landlock grants only /dev/null for writes', async () => {
  let grants = null;
  __setSandboxOsTestHooks({
    Landlock: {
      launcherPath: () => '/npm/bin/landlock-run',
      probe: () => 'partial',
      grantArgs(value) {
        grants = value;
        return [];
      },
    },
  });
  try {
    const out = await wrapShellCommandForSandbox({
      command: 'echo hi',
      config: { sandbox: { enabled: true, mode: 'read-only' } },
      cwd: '/tmp/project',
      platform: 'linux',
      binShell: 'bash',
    });
    assert.deepEqual(grants, { readOnly: ['/'], readWrite: ['/dev/null'] });
    assert.equal(out.enforcement, 'partial');
  } finally {
    __setSandboxOsTestHooks(null);
  }
});

test('macOS Seatbelt allowWrite includes tower git commit dirs', async () => {
  let allowWrite = null;
  __setSandboxOsTestHooks({
    SandboxManager: {
      async initialize() {},
      isSandboxingEnabled: () => true,
      isSupportedPlatform: () => true,
      async wrapWithSandbox(_command, _shell, config) {
        allowWrite = config?.filesystem?.allowWrite;
        return 'sandbox-exec -- git commit';
      },
    },
  });
  try {
    const parent = '/tmp/codemini-seatbelt-tower-parent';
    const worktree = `${parent}/.codemini/tower/worktrees/alisa`;
    const out = await wrapShellCommandForSandbox({
      command: 'git commit -m sealed',
      config: { sandbox: { enabled: true, mode: 'workspace-write' } },
      cwd: worktree,
      platform: 'darwin',
      binShell: 'bash',
    });
    assert.equal(out.wrapped, true);
    assert.ok(allowWrite.includes(out.policy.workspaceRoot));
    assert.ok(allowWrite.includes(`${parent}/.git/objects`));
    assert.ok(allowWrite.includes(`${parent}/.git/worktrees/alisa`));
    assert.ok(allowWrite.includes(`${parent}/.git/refs/heads/codemini-tower`));
    assert.equal(allowWrite.includes(parent), false);
    assert.equal(allowWrite.includes(`${parent}/.git`), false);
    assert.equal(allowWrite.includes(`${parent}/.git/hooks`), false);
  } finally {
    __setSandboxOsTestHooks(null);
  }
});

test('macOS keeps the built-in Seatbelt backend and allows network', async () => {
  let networkCallback = null;
  __setSandboxOsTestHooks({
    SandboxManager: {
      async initialize(_config, callback) {
        networkCallback = callback;
      },
      isSandboxingEnabled: () => true,
      isSupportedPlatform: () => true,
      async wrapWithSandbox(command) {
        return `sandbox-exec -- ${command}`;
      },
    },
  });
  try {
    const out = await wrapShellCommandForSandbox({
      command: 'echo hi',
      config: { sandbox: { enabled: true, mode: 'workspace-write' } },
      cwd: '/tmp/project',
      platform: 'darwin',
      binShell: 'bash',
    });
    assert.equal(out.wrapped, true);
    assert.equal(out.command, 'sandbox-exec -- echo hi');
    assert.equal(await networkCallback({ host: 'example.com', port: 443 }), true);
  } finally {
    __setSandboxOsTestHooks(null);
  }
});

test('wrapShellCommandForSandbox fail-closed when Landlock is unavailable', async () => {
  __setSandboxOsTestHooks({
    Landlock: {
      launcherPath: () => '/missing/landlock-run',
      probe: () => 'unusable',
      grantArgs: () => [],
    },
  });
  try {
    await assert.rejects(
      () =>
        wrapShellCommandForSandbox({
          command: 'echo hi',
          config: { sandbox: { enabled: true, mode: 'read-only' } },
          cwd: '/tmp/project',
          platform: 'linux',
        }),
      (err) =>
        err instanceof SandboxUnavailableError
        && err.code === 'SANDBOX_UNAVAILABLE'
        && /npm install in this Linux environment/i.test(err.message)
        && !/apt-get|bubblewrap|socat/i.test(err.message),
    );
  } finally {
    __setSandboxOsTestHooks(null);
  }
});

test('danger-full-access does not wrap', async () => {
  __setSandboxOsTestHooks({
    SandboxManager: {
      async initialize() {
        throw new Error('should not init');
      },
      isSandboxingEnabled: () => true,
      isSupportedPlatform: () => true,
      async wrapWithSandbox() {
        throw new Error('should not wrap');
      },
    },
  });
  try {
    const out = await wrapShellCommandForSandbox({
      command: 'echo hi',
      config: { sandbox: { enabled: true, mode: 'danger-full-access' } },
      cwd: '/tmp/project',
      platform: 'linux',
    });
    assert.equal(out.wrapped, false);
  } finally {
    __setSandboxOsTestHooks(null);
  }
});
