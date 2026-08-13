import test from 'node:test';
import assert from 'node:assert/strict';
import {
  __setSandboxProbeTestHooks,
  canUseOsConfine,
  rememberOsFallback,
  selectSandboxBackend,
} from '../src/core/sandbox-probe.js';
import { resolveSandboxPolicy } from '../src/core/sandbox-policy.js';
import { resolveShellContext } from '../src/core/shell-profile.js';
import { prepareSandboxExecution } from '../src/core/sandbox-backend.js';
import { __setSandboxOsTestHooks } from '../src/core/sandbox-os.js';
import { __setSandboxRuntimeTestHooks, SandboxUnavailableError } from '../src/core/sandbox-runtime.js';

test('selectSandboxBackend uses OS confine when msb is missing on unix', () => {
  __setSandboxProbeTestHooks({ resolveMsbBinary: () => null });
  try {
    assert.equal(selectSandboxBackend({ preferred: 'auto', platform: 'darwin', arch: 'x64' }), 'os');
    assert.equal(selectSandboxBackend({ preferred: 'auto', platform: 'linux', arch: 'x64' }), 'os');
    assert.equal(selectSandboxBackend({ preferred: 'auto', platform: 'win32', arch: 'x64' }), 'none');
    assert.equal(selectSandboxBackend({ preferred: 'microsandbox', platform: 'darwin' }), 'vm');
    assert.equal(selectSandboxBackend({ preferred: 'os', platform: 'win32' }), 'none');
    assert.equal(canUseOsConfine('darwin'), true);
    assert.equal(canUseOsConfine('win32'), false);
  } finally {
    __setSandboxProbeTestHooks(null);
  }
});

test('resolveSandboxPolicy records vm vs os vs none backends', () => {
  __setSandboxProbeTestHooks({ resolveMsbBinary: () => null });
  try {
    assert.equal(
      resolveSandboxPolicy({
        config: { sandbox: { enabled: 'auto', mode: 'workspace-write' } },
        platform: 'darwin',
      }).backend,
      'os',
    );
    assert.equal(
      resolveSandboxPolicy({
        config: { sandbox: { enabled: 'auto', mode: 'workspace-write', backend: 'microsandbox' } },
        platform: 'darwin',
      }).backend,
      'vm',
    );
    const win = resolveSandboxPolicy({
      config: { sandbox: { enabled: 'auto', mode: 'workspace-write' } },
      platform: 'win32',
    });
    assert.equal(win.enabled, true);
    assert.equal(win.backend, 'none');
  } finally {
    __setSandboxProbeTestHooks(null);
  }
});

test('resolveShellContext keeps host cwd for OS backend', () => {
  __setSandboxProbeTestHooks({ resolveMsbBinary: () => null });
  try {
    const osContext = resolveShellContext(
      { sandbox: { enabled: true, mode: 'workspace-write', backend: 'os' }, shell: { default: 'bash' } },
      { cwd: '/tmp/project', platform: 'darwin' },
    );
    assert.equal(osContext.sandbox.backend, 'os');
    assert.equal(osContext.commandPlatform, 'darwin');
    assert.equal(osContext.commandCwd, '/tmp/project');
    assert.equal(osContext.shell, 'bash');

    const vmContext = resolveShellContext(
      { sandbox: { enabled: true, mode: 'workspace-write', backend: 'microsandbox' }, shell: { default: 'bash' } },
      { cwd: '/tmp/project', platform: 'darwin' },
    );
    assert.equal(vmContext.sandbox.backend, 'vm');
    assert.equal(vmContext.commandPlatform, 'linux');
    assert.equal(vmContext.commandCwd, '/workspace');
  } finally {
    __setSandboxProbeTestHooks(null);
  }
});

test('prepareSandboxExecution falls back to OS confine when VM start fails on unix', async () => {
  __setSandboxProbeTestHooks({ resolveMsbBinary: () => '/tmp/msb' });
  __setSandboxRuntimeTestHooks({
    createSandbox: async () => {
      throw new Error('hypervisor unavailable');
    },
  });
  __setSandboxOsTestHooks({
    SandboxManager: {
      async initialize() {},
      isSandboxingEnabled: () => true,
      isSupportedPlatform: () => true,
      async wrapWithSandbox(command) {
        return `sandbox-exec -- ${command}`;
      },
    },
  });
  try {
    const prepared = await prepareSandboxExecution({
      command: 'echo hi',
      config: { sandbox: { enabled: true, mode: 'workspace-write', backend: 'microsandbox' } },
      cwd: '/tmp/project',
      platform: 'darwin',
      binShell: 'bash',
    });
    assert.equal(prepared.kind, 'os');
    assert.equal(prepared.command, 'sandbox-exec -- echo hi');
    assert.equal(
      resolveSandboxPolicy({
        config: { sandbox: { enabled: true, mode: 'workspace-write' } },
        platform: 'darwin',
      }).backend,
      'os',
    );
  } finally {
    __setSandboxRuntimeTestHooks(null);
    __setSandboxOsTestHooks(null);
    __setSandboxProbeTestHooks(null);
  }
});

test('prepareSandboxExecution fail-closed on Windows when VM is unavailable', async () => {
  __setSandboxProbeTestHooks({ resolveMsbBinary: () => null });
  try {
    await assert.rejects(
      () =>
        prepareSandboxExecution({
          command: 'echo hi',
          config: { sandbox: { enabled: true, mode: 'workspace-write' } },
          cwd: '/tmp/project',
          platform: 'win32',
        }),
      (err) => err instanceof SandboxUnavailableError && /Windows has no Landlock\/Seatbelt fallback/i.test(err.message),
    );
  } finally {
    __setSandboxProbeTestHooks(null);
  }
});
