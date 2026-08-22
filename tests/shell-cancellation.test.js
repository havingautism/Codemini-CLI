import test from 'node:test';
import assert from 'node:assert/strict';
import { runShellCommand } from '../src/core/shell.js';
import { __setSandboxRuntimeTestHooks } from '../src/core/sandbox-runtime.js';

test('runShellCommand timeout settles when a sandbox process never closes', async () => {
  __setSandboxRuntimeTestHooks({
    createSandbox: async () => ({
      async execStreamWith() {
        return {
          async *[Symbol.asyncIterator]() {
            yield { kind: 'started', pid: 42 };
            await new Promise(() => {});
          },
          async signal() {},
          async kill() {},
        };
      },
    }),
  });

  try {
    const outcome = await Promise.race([
      runShellCommand({
        command: 'true',
        timeoutMs: 20,
        config: {
          sandbox: {
            enabled: true,
            mode: 'workspace-write',
            backend: 'microsandbox',
          },
        },
      }).catch((error) => error),
      new Promise((resolve) => setTimeout(() => resolve(null), 500)),
    ]);

    assert.match(outcome?.message || '', /timed out after 20ms/);
  } finally {
    __setSandboxRuntimeTestHooks(null);
  }
});

test('runShellCommand aborts a running command and waits for process settlement', async () => {
  const controller = new AbortController();
  const startedAt = Date.now();
  const running = runShellCommand({
    command: process.platform === 'win32' ? 'Start-Sleep -Seconds 30' : 'sleep 30',
    shell: process.platform === 'win32' ? 'powershell' : 'bash',
    timeoutMs: 30_000,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 50);

  await assert.rejects(running, (error) => error?.code === 'ABORT_ERR');
  assert.ok(Date.now() - startedAt < 5_000);
});

test('runShellCommand rejects a signal aborted before dispatch', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runShellCommand({ command: 'echo unreachable', signal: controller.signal }),
    (error) => error?.code === 'ABORT_ERR',
  );
});
