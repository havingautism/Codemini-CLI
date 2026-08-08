import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCommandRisk, requiresApprovalEvaluation } from '../src/core/command-risk.js';

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
  for (const command of ['npm install', 'rm -rf dist', 'git commit -m x', 'mkdir foo']) {
    assert.equal(classifyCommandRisk(command), 'write-high-risk', command);
  }
});
