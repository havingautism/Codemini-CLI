import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {
  assertSandboxWriteAllowed,
  isSandboxEnabled,
  normalizeSandboxMode,
  resolveApprovalUiEnabled,
  resolveSandboxPolicy,
  validateSandboxEscalationArgs,
  writableRootsForMode,
} from '../src/core/sandbox-policy.js';

test('normalizeSandboxMode defaults to workspace-write on every platform', () => {
  assert.equal(normalizeSandboxMode('', { platform: 'win32' }), 'workspace-write');
  assert.equal(normalizeSandboxMode('', { platform: 'linux' }), 'workspace-write');
  assert.equal(normalizeSandboxMode('read_only'), 'read-only');
});

test('sandbox escalation requires paired fields and a strictly wider mode', () => {
  const options = {
    config: { sandbox: { enabled: true, mode: 'read-only' } },
    cwd: '/tmp/ws',
    platform: 'linux',
  };
  assert.throws(
    () => validateSandboxEscalationArgs({ sandbox_permissions: 'workspace-write' }, options),
    /requires a justification/,
  );
  assert.throws(
    () => validateSandboxEscalationArgs({ justification: 'why' }, options),
    /only valid together/,
  );
  assert.throws(
    () => validateSandboxEscalationArgs({ sandbox_permissions: 'workspace-write', justification: ' ' }, options),
    /non-empty sentence/,
  );
  assert.equal(
    validateSandboxEscalationArgs({
      sandbox_permissions: 'workspace-write',
      justification: 'the operation needs workspace writes',
    }, options).mode,
    'workspace-write',
  );
});

test('isSandboxEnabled auto is on on every platform', () => {
  assert.equal(isSandboxEnabled({ sandbox: { enabled: 'auto' } }, { platform: 'win32' }), true);
  assert.equal(isSandboxEnabled({ sandbox: { enabled: 'auto' } }, { platform: 'linux' }), true);
  assert.equal(isSandboxEnabled({ sandbox: { enabled: false } }, { platform: 'linux' }), false);
});

test('resolveSandboxPolicy enables workspace-write on Windows', () => {
  const policy = resolveSandboxPolicy({
    config: { sandbox: { mode: 'workspace-write', enabled: 'auto' } },
    cwd: '/tmp/ws',
    platform: 'win32',
  });
  assert.equal(policy.enabled, true);
  assert.equal(policy.mode, 'workspace-write');
});

test('resolveSandboxPolicy enables workspace-write on linux', () => {
  const policy = resolveSandboxPolicy({
    config: { sandbox: { mode: 'workspace-write', enabled: 'auto' } },
    cwd: '/tmp/ws',
    platform: 'linux',
  });
  assert.equal(policy.enabled, true);
  assert.equal(policy.mode, 'workspace-write');
  assert.equal(policy.workspaceRoot, path.resolve('/tmp/ws'));
});

test('approval UI is hidden for read-only sandbox on every platform', () => {
  assert.equal(
    resolveApprovalUiEnabled({
      config: { sandbox: { mode: 'read-only', enabled: 'auto' } },
      cwd: '/tmp/ws',
      platform: 'linux',
    }),
    false,
  );
  assert.equal(
    resolveApprovalUiEnabled({
      config: { sandbox: { mode: 'workspace-write', enabled: 'auto' } },
      cwd: '/tmp/ws',
      platform: 'linux',
    }),
    true,
  );
  assert.equal(
    resolveApprovalUiEnabled({
      config: { sandbox: { mode: 'read-only', enabled: 'auto' } },
      cwd: '/tmp/ws',
      platform: 'win32',
    }),
    false,
  );
});

test('assertSandboxWriteAllowed fences read-only and workspace-write', () => {
  const ws = path.resolve(os.tmpdir(), 'codemini-sandbox-policy-ws');
  const inside = path.join(ws, 'a.txt');
  const outside = path.resolve(os.tmpdir(), '..', 'codemini-outside-forbid.txt');

  assert.equal(
    assertSandboxWriteAllowed(inside, {
      enabled: true,
      mode: 'read-only',
      workspaceRoot: ws,
      platform: 'linux',
    }),
    '[sandbox: file access denied under read-only mode]',
  );

  assert.equal(
    assertSandboxWriteAllowed(inside, {
      enabled: true,
      mode: 'workspace-write',
      workspaceRoot: ws,
      platform: 'linux',
    }),
    null,
  );

  const denied = assertSandboxWriteAllowed(outside, {
    enabled: true,
    mode: 'workspace-write',
    workspaceRoot: ws,
    platform: 'linux',
  });
  // Outside workspace may still land under tmpdir writable root — only assert
  // denial when the path is outside every writable root.
  const roots = writableRootsForMode({
    mode: 'workspace-write',
    workspaceRoot: ws,
  });
  const underTmp = roots.some((root) => {
    const rel = path.relative(root, outside);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
  if (!underTmp) {
    assert.match(String(denied || ''), /sandbox: file access denied/);
  }
});
