import test from 'node:test';
import assert from 'node:assert/strict';
import {
  __setSandboxRuntimeTestHooks,
  SandboxUnavailableError,
  wrapShellCommandForSandbox,
} from '../src/core/sandbox-runtime.js';

test('wrapShellCommandForSandbox skips on win32', async () => {
  __setSandboxRuntimeTestHooks({
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
    __setSandboxRuntimeTestHooks(null);
  }
});

test('wrapShellCommandForSandbox wraps on linux via SandboxManager', async () => {
  let initConfig = null;
  __setSandboxRuntimeTestHooks({
    SandboxManager: {
      async initialize(config) {
        initConfig = config;
      },
      isSandboxingEnabled: () => true,
      isSupportedPlatform: () => true,
      async wrapWithSandbox(command) {
        return `bwrap -- ${command}`;
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
    assert.equal(out.command, 'bwrap -- echo hi');
    assert.ok(Array.isArray(initConfig?.filesystem?.allowWrite));
    assert.equal(initConfig.network, undefined);
  } finally {
    __setSandboxRuntimeTestHooks(null);
  }
});

test('wrapShellCommandForSandbox fail-closed when initialize fails', async () => {
  __setSandboxRuntimeTestHooks({
    SandboxManager: {
      async initialize() {
        throw new Error('no bwrap');
      },
      isSandboxingEnabled: () => false,
      isSupportedPlatform: () => true,
      async wrapWithSandbox() {
        return 'x';
      },
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
      (err) => err instanceof SandboxUnavailableError && err.code === 'SANDBOX_UNAVAILABLE',
    );
  } finally {
    __setSandboxRuntimeTestHooks(null);
  }
});

test('danger-full-access does not wrap', async () => {
  __setSandboxRuntimeTestHooks({
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
    __setSandboxRuntimeTestHooks(null);
  }
});
