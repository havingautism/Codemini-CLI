import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {
  assertSandboxWriteAllowed,
  isSandboxEnabled,
  normalizeSandboxMode,
  normalizeSandboxNetwork,
  readonlySandboxRoots,
  readonlySandboxVolumes,
  toSandboxSkillPath,
  resolveApprovalUiEnabled,
  resolveSandboxPolicy,
  validateSandboxEscalationArgs,
  writableRootsForMode,
} from '../src/core/sandbox-policy.js';
import { getSessionsDir, getSkillsDir } from '../src/core/paths.js';
import { __setSandboxProbeTestHooks } from '../src/core/sandbox-probe.js';

test('normalizeSandboxMode defaults to workspace-write on every platform', () => {
  assert.equal(normalizeSandboxMode('', { platform: 'win32' }), 'workspace-write');
  assert.equal(normalizeSandboxMode('', { platform: 'linux' }), 'workspace-write');
  assert.equal(normalizeSandboxMode('read_only'), 'read-only');
});

test('normalizeSandboxNetwork defaults to allow-all and maps deny aliases', () => {
  assert.equal(normalizeSandboxNetwork(undefined), 'allow-all');
  assert.equal(normalizeSandboxNetwork(''), 'allow-all');
  assert.equal(normalizeSandboxNetwork('allow-all'), 'allow-all');
  assert.equal(normalizeSandboxNetwork('ALL_ALL'), 'allow-all');
  assert.equal(normalizeSandboxNetwork('bogus'), 'allow-all');
  assert.equal(normalizeSandboxNetwork('none'), 'none');
  assert.equal(normalizeSandboxNetwork('deny-all'), 'none');
  assert.equal(normalizeSandboxNetwork('deny_all'), 'none');
  assert.equal(normalizeSandboxNetwork('deny'), 'none');
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

test('resolveSandboxPolicy records vm, os, and none backends', () => {
  __setSandboxProbeTestHooks({ resolveMsbBinary: () => null });
  try {
    assert.equal(
      resolveSandboxPolicy({
        config: { sandbox: { enabled: 'auto', mode: 'workspace-write' } },
        cwd: '/tmp/ws',
        platform: 'darwin',
      }).backend,
      'os',
    );
    assert.equal(
      resolveSandboxPolicy({
        config: { sandbox: { enabled: 'auto', mode: 'workspace-write', backend: 'microsandbox' } },
        cwd: '/tmp/ws',
        platform: 'darwin',
      }).backend,
      'vm',
    );
    const win = resolveSandboxPolicy({
      config: { sandbox: { enabled: 'auto', mode: 'workspace-write' } },
      cwd: '/tmp/ws',
      platform: 'win32',
    });
    assert.equal(win.enabled, true);
    assert.equal(win.backend, 'none');
  } finally {
    __setSandboxProbeTestHooks(null);
  }
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

test('workspace-write tower workers can commit via parent git dirs only', () => {
  // Keep the fake parent outside os.tmpdir(); tmpdir is always writable.
  const parent = path.resolve('/opt/codemini-sandbox-tower-parent');
  const worktree = path.join(parent, '.codemini', 'tower', 'worktrees', 'alisa');
  const policy = {
    enabled: true,
    mode: 'workspace-write',
    workspaceRoot: worktree,
    platform: 'darwin',
  };
  const roots = writableRootsForMode(policy);
  assert.ok(roots.includes(path.resolve(worktree)));
  assert.ok(roots.includes(path.join(parent, '.git', 'objects')));
  assert.ok(roots.includes(path.join(parent, '.git', 'worktrees', 'alisa')));
  assert.ok(roots.includes(path.join(parent, '.git', 'refs', 'heads', 'codemini-tower')));
  assert.equal(roots.includes(parent), false);
  assert.equal(roots.includes(path.join(parent, '.git')), false);

  const allow = (target) => assertSandboxWriteAllowed(target, policy);
  assert.equal(allow(path.join(worktree, 'notes.md')), null);
  assert.equal(allow(path.join(parent, '.git', 'objects', 'ab', 'cdef')), null);
  assert.equal(allow(path.join(parent, '.git', 'worktrees', 'alisa', 'index.lock')), null);
  assert.equal(allow(path.join(parent, '.git', 'refs', 'heads', 'codemini-tower', 'alisa')), null);
  assert.match(String(allow(path.join(parent, 'notes.md')) || ''), /sandbox: file access denied/);
  assert.match(String(allow(path.join(parent, '.git', 'hooks', 'pre-commit')) || ''), /sandbox: file access denied/);
  assert.match(String(allow(path.join(parent, '.git', 'config')) || ''), /sandbox: file access denied/);
  assert.match(String(allow(path.join(parent, '.git', 'refs', 'heads', 'main')) || ''), /sandbox: file access denied/);

  const codingRoots = writableRootsForMode({
    mode: 'workspace-write',
    workspaceRoot: parent,
  });
  assert.equal(codingRoots.includes(path.join(parent, '.git', 'objects')), false);
  assert.match(
    String(assertSandboxWriteAllowed(path.join(parent, '.git', 'objects', 'ab', 'cdef'), {
      enabled: true,
      mode: 'read-only',
      workspaceRoot: worktree,
      platform: 'darwin',
    }) || ''),
    /sandbox: file access denied under read-only mode/,
  );
});

test('readonly sandbox roots expose global skills but not sessions or writes', () => {
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  const globalDir = path.resolve('/opt/codemini-readonly-skills-global');
  process.env.CODEMINI_GLOBAL_DIR = globalDir;
  try {
    const ws = path.join(os.tmpdir(), 'codemini-readonly-skills-ws');
    const policy = { mode: 'workspace-write', workspaceRoot: ws, platform: 'darwin' };
    const roots = readonlySandboxRoots(policy);
    assert.deepEqual(roots, [getSkillsDir()]);
    assert.equal(roots.includes(getSessionsDir()), false);
    assert.equal(writableRootsForMode(policy).includes(getSkillsDir()), false);
    assert.match(
      String(assertSandboxWriteAllowed(path.join(getSkillsDir(), 'demo', 'SKILL.md'), {
        enabled: true,
        mode: 'workspace-write',
        workspaceRoot: ws,
        platform: 'darwin',
      }) || ''),
      /sandbox: file access denied/,
    );
    assert.deepEqual(readonlySandboxVolumes({ ...policy, platform: 'darwin' }), [{
      hostPath: getSkillsDir(),
      guestPath: '/codemini-skills',
      readonly: true,
    }]);
    assert.deepEqual(readonlySandboxVolumes({ ...policy, platform: 'win32' }), [{
      hostPath: getSkillsDir(),
      guestPath: '/codemini-skills',
      readonly: true,
    }]);
    assert.equal(
      toSandboxSkillPath(path.join(getSkillsDir(), 'demo', 'scripts', 'score.py'), {
        ...policy,
        platform: 'win32',
      }),
      '/codemini-skills/demo/scripts/score.py',
    );
    assert.equal(
      toSandboxSkillPath(path.join(getSkillsDir(), 'demo', 'scripts', 'score.py'), policy),
      '/codemini-skills/demo/scripts/score.py',
    );
  } finally {
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
  }
});

test('skills inside the workspace are not extra-mounted', () => {
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  const ws = path.join(os.tmpdir(), 'codemini-skills-inside-ws');
  process.env.CODEMINI_GLOBAL_DIR = ws;
  try {
    assert.deepEqual(readonlySandboxRoots({
      mode: 'workspace-write',
      workspaceRoot: ws,
      platform: 'darwin',
    }), []);
  } finally {
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
  }
});
