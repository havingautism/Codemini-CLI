import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCommandRisk, requiresApprovalEvaluation } from '../src/core/command-risk.js';
import { evaluateCommandPolicy } from '../src/core/command-policy.js';

test('interpreter and package-script commands are never classified as read-only', () => {
  for (const command of [
    'node -e "process.stdout.write(\'ok\')"',
    'python -c "print(1)"',
    'py -m pytest',
    'npm test',
    'npm install',
    'npx vitest run',
  ]) {
    assert.notEqual(classifyCommandRisk(command), 'read-only', command);
    assert.equal(requiresApprovalEvaluation(command), true, command);
  }
});

test('ordinary inspection commands remain read-only', () => {
  for (const command of [
    'rg ToolRegistry src',
    'Get-Content package.json',
    'git status',
    'dir',
    'gci src',
    'npm list',
    'npm ls --depth=0',
    'node --version',
    'python --version',
    'which node',
    'tree src',
  ]) {
    assert.equal(classifyCommandRisk(command), 'read-only', command);
    assert.equal(requiresApprovalEvaluation(command), false, command);
  }
});

test('bash safe-mode allowlist accepts the same ordinary read-only commands', () => {
  const command = 'echo "hello from shell" && date && pwd';
  const config = {
    shell: { default: 'bash' },
    policy: {
      safe_mode: true,
      allow_dangerous_commands: false,
      allowed_paths: [],
      command_allowlist: [],
      blocked_commands: [],
      blocked_path_patterns: [],
      blocked_command_patterns: [],
    },
  };

  assert.equal(classifyCommandRisk(command, 'bash', 'linux'), 'read-only');
  assert.deepEqual(evaluateCommandPolicy(command, config), { allowed: true });
});

test('read-only scanners do not inherit high-risk keywords from arguments', () => {
  for (const command of [
    'rg install src',
    'grep -R commit .',
    'git log --grep=commit',
    'find . -name "*rm*"',
  ]) {
    assert.equal(classifyCommandRisk(command), 'read-only', command);
  }
});

test('mutating package and shell commands stay elevated', () => {
  for (const command of [
    'npm install',
    'rm -rf dist',
    'git commit -m x',
    'mkdir foo',
  ]) {
    assert.equal(classifyCommandRisk(command), 'write-high-risk', command);
  }
});

test('Unix tightens dual-use commands without changing Windows classification', () => {
  for (const command of [
    'find . -exec rm -rf {} +',
    'git status > status.txt',
  ]) {
    assert.equal(classifyCommandRisk(command, 'bash', 'linux'), 'write-high-risk', command);
    assert.equal(classifyCommandRisk(command, 'powershell', 'win32'), 'read-only', command);
  }
  for (const command of [
    'date --set="2026-01-01"',
    'env bash -c "echo changed > file"',
    'sort input.txt -o output.txt',
  ]) {
    assert.notEqual(classifyCommandRisk(command, 'bash', 'linux'), 'read-only', command);
  }
  for (const command of [
    'git branch -D tmp',
    'git tag -d v1',
    'git config user.email x@y',
    'npm version patch',
    'go env -w GOPROXY=off',
  ]) {
    assert.notEqual(classifyCommandRisk(command, 'bash', 'linux'), 'read-only', command);
    assert.equal(classifyCommandRisk(command, 'powershell', 'win32'), 'read-only', command);
  }
});
