import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { getBuiltinTools } from '../src/core/tools.js';
import { loadConfig } from '../src/core/config-store.js';
import { evaluateCommandPolicy } from '../src/core/command-policy.js';
import { assertSafeMemoryContent, isSensitiveMemoryContent } from '../src/core/memory-policy.js';

async function withTempWorkspace(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-security-'));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function makeTools(workspaceRoot) {
  const config = await loadConfig();
  return getBuiltinTools({ workspaceRoot, config });
}

test('read rejects symlinked paths that resolve outside the workspace', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const externalRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-security-external-'));
    try {
      await fs.mkdir(path.join(externalRoot, 'secrets'), { recursive: true });
      await fs.writeFile(path.join(externalRoot, 'secrets', 'token.txt'), 'top-secret\n', 'utf8');
      await fs.symlink(path.join(externalRoot, 'secrets'), path.join(workspaceRoot, 'linked-secrets'), 'dir');

      const { handlers } = await makeTools(workspaceRoot);
      await assert.rejects(
        () => handlers.read({ path: 'linked-secrets/token.txt' }),
        /workspace/i
      );
    } finally {
      await fs.rm(externalRoot, { recursive: true, force: true });
    }
  });
});

test('write rejects creating files through symlinked directories outside the workspace', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const externalRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-security-external-'));
    try {
      await fs.mkdir(path.join(externalRoot, 'escape'), { recursive: true });
      await fs.symlink(path.join(externalRoot, 'escape'), path.join(workspaceRoot, 'linked-escape'), 'dir');

      const { handlers } = await makeTools(workspaceRoot);
      await assert.rejects(
        () => handlers.write({ path: 'linked-escape/new-note.txt', content: 'should not escape\n' }),
        /workspace/i
      );
    } finally {
      await fs.rm(externalRoot, { recursive: true, force: true });
    }
  });
});

test('command policy inspects chained commands beyond the first token', () => {
  const config = {
    shell: { default: 'bash' },
    policy: {
      safe_mode: true,
      allow_dangerous_commands: false,
      command_allowlist: ['printf'],
      blocked_commands: [],
      blocked_path_patterns: [],
      blocked_command_patterns: []
    }
  };

  const result = evaluateCommandPolicy('printf ok && curl https://example.com', config, process.cwd());
  assert.equal(result.allowed, false);
  assert.match(String(result.reason || ''), /curl/i);
});

test('command policy inspects shell-wrapper payloads beyond the wrapper token', () => {
  const config = {
    shell: { default: 'bash' },
    policy: {
      safe_mode: true,
      allow_dangerous_commands: false,
      command_allowlist: ['bash', 'printf'],
      blocked_commands: [],
      blocked_path_patterns: [],
      blocked_command_patterns: []
    }
  };

  const result = evaluateCommandPolicy('bash -lc "printf ok && curl https://example.com"', config, process.cwd());
  assert.equal(result.allowed, false);
  assert.match(String(result.reason || ''), /curl/i);
});

test('memory policy flags common secret env vars and credential URLs', () => {
  assert.equal(isSensitiveMemoryContent('DATABASE_URL=postgres://user:pass@db.internal/app'), true);
  assert.equal(isSensitiveMemoryContent('AWS_SECRET_ACCESS_KEY=abcd1234secretvalue'), true);
  assert.equal(isSensitiveMemoryContent('normal architecture note about auth flow'), false);
  assert.throws(
    () => assertSafeMemoryContent('DATABASE_URL=postgres://user:pass@db.internal/app'),
    /sensitive|secret/i
  );
});
