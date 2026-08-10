import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  __setSandboxRuntimeTestHooks,
  createSandboxProcess,
  SandboxUnavailableError,
} from '../src/core/sandbox-runtime.js';

function fakeSandbox(events, captured = {}) {
  return {
    async execStreamWith(command, configure) {
      captured.command = command;
      const builder = {
        args(value) { captured.args = value; return this; },
        cwd(value) { captured.cwd = value; return this; },
      };
      configure(builder);
      return {
        async *[Symbol.asyncIterator]() {
          for (const event of events) yield event;
        },
        async signal(value) { captured.signal = value; },
        async kill() { captured.killed = true; },
      };
    },
  };
}

test('Microsandbox executes Bash in /workspace and streams output on every host', async () => {
  const captured = {};
  __setSandboxRuntimeTestHooks({
    createSandbox: async (options) => {
      captured.options = options;
      return fakeSandbox([
        { kind: 'started', pid: 42 },
        { kind: 'exited', code: 0 },
        { kind: 'stdout', data: Buffer.from('hello\n') },
      ], captured);
    },
  });
  try {
    const wrapped = createSandboxProcess({
      command: 'echo hello',
      config: { sandbox: { enabled: 'auto', mode: 'workspace-write', image: 'node:22-bookworm' } },
      cwd: process.cwd(),
    });
    assert.equal(wrapped.policy.enabled, true);
    let stdout = '';
    wrapped.child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    const [code] = await once(wrapped.child, 'close');
    assert.equal(code, 0);
    assert.equal(stdout, 'hello\n');
    assert.equal(captured.command, '/bin/bash');
    assert.deepEqual(captured.args, ['-lc', 'echo hello']);
    assert.equal(captured.cwd, '/workspace');
    assert.equal(captured.options.policy.workspaceRoot, process.cwd());
  } finally {
    __setSandboxRuntimeTestHooks(null);
  }
});

test('Microsandbox is reused for commands with the same workspace and mode', async () => {
  let creates = 0;
  __setSandboxRuntimeTestHooks({
    createSandbox: async () => {
      creates += 1;
      return fakeSandbox([{ kind: 'exited', code: 0 }]);
    },
  });
  try {
    const config = { sandbox: { enabled: true, mode: 'read-only' } };
    const first = createSandboxProcess({ command: 'true', config, cwd: process.cwd() });
    await once(first.child, 'close');
    const second = createSandboxProcess({ command: 'true', config, cwd: process.cwd() });
    await once(second.child, 'close');
    assert.equal(creates, 1);
  } finally {
    __setSandboxRuntimeTestHooks(null);
  }
});

test('Microsandbox startup failure is fail-closed', async () => {
  __setSandboxRuntimeTestHooks({
    createSandbox: async () => { throw new Error('WHP is unavailable'); },
  });
  try {
    const wrapped = createSandboxProcess({
      command: 'echo unsafe',
      config: { sandbox: { enabled: true, mode: 'workspace-write' } },
      cwd: process.cwd(),
    });
    const [error] = await once(wrapped.child, 'error');
    assert.ok(error instanceof SandboxUnavailableError);
    assert.match(error.message, /refusing to run on the host/i);
    assert.match(error.message, /WHP is unavailable/);
  } finally {
    __setSandboxRuntimeTestHooks(null);
  }
});

test('explicitly disabled sandbox returns native execution', () => {
  const wrapped = createSandboxProcess({
    command: 'echo host',
    config: { sandbox: { enabled: false, mode: 'workspace-write' } },
    cwd: process.cwd(),
  });
  assert.equal(wrapped, null);
});
