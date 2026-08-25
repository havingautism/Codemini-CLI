import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createSandboxProcess, closeAllSandboxes } from '../src/core/sandbox-runtime.js';
import { hasMicrosandboxBinary } from '../src/core/sandbox-probe.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';

// Opt-in: real microVMs are heavy, so this file is skipped unless the env flag
// is set. Run with:  CODEMINI_SANDBOX_VM_TEST=1 node --test tests/sandbox-vm-integration.test.js
const ENABLED = process.env.CODEMINI_SANDBOX_VM_TEST === '1';

test('real microsandbox VM executes in /workspace and resolves public DNS', { timeout: 240_000 }, async (t) => {
  if (!ENABLED) {
    return t.skip('set CODEMINI_SANDBOX_VM_TEST=1 to run real-VM integration tests');
  }
  if (!hasMicrosandboxBinary()) {
    return t.skip('microsandbox binary not installed for this platform');
  }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-vm-it-'));
  t.after(async () => {
    await closeAllSandboxes().catch(() => {});
    closeSqliteDatabasesForTests();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const wrapped = createSandboxProcess({
    command: 'echo vm-ok && pwd && cat /etc/resolv.conf && node -e "require(\'node:dns\').lookup(\'example.com\', (error, address) => { if (error) throw error; console.log(\'dns-ok\', address); })"',
    config: {
      sandbox: {
        enabled: true,
        mode: 'workspace-write',
        image: 'node:22-bookworm',
        network: 'allow-all', // default behavior preserved
      },
    },
    cwd: root,
  });
  assert.notEqual(wrapped, null, 'sandbox process created');
  assert.equal(wrapped.policy.enabled, true);
  assert.equal(wrapped.policy.mode, 'workspace-write');

  let stdout = '';
  let stderr = '';
  wrapped.child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  wrapped.child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const [code] = await once(wrapped.child, 'close');

  assert.equal(code, 0, `exit code 0; stdout: ${stdout.slice(0, 500)}; stderr: ${stderr.slice(0, 500)}`);
  assert.equal(stdout.includes('vm-ok'), true, `stdout contains vm-ok; got: ${stdout}`);
  assert.equal(stdout.includes('/workspace'), true, `cwd is /workspace; got: ${stdout}`);
  assert.equal(stdout.includes('dns-ok'), true, `stdout contains dns-ok; got: ${stdout}`);
});

test('closeAllSandboxes resolves and is idempotent', { timeout: 60_000 }, async (t) => {
  if (!ENABLED) {
    return t.skip('set CODEMINI_SANDBOX_VM_TEST=1 to run real-VM integration tests');
  }
  // No sandboxes may exist in this fresh process, but the call must resolve
  // cleanly and a second call must return the same settled promise.
  const first = closeAllSandboxes();
  assert.equal(closeAllSandboxes(), first, 'idempotent');
  await first;
});
