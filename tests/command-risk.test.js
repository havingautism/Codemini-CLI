import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCommandRisk, requiresApprovalEvaluation } from '../src/core/command-risk.js';

test('interpreter and package-script commands are never classified as read-only', () => {
  for (const command of [
    'node -e "process.stdout.write(\'ok\')"',
    'python -c "print(1)"',
    'py -m pytest',
    'npm test',
    'npx vitest run',
    'pip list',
  ]) {
    assert.notEqual(classifyCommandRisk(command), 'read-only', command);
    assert.equal(requiresApprovalEvaluation(command), true, command);
  }
});

test('ordinary inspection commands remain read-only', () => {
  for (const command of ['rg ToolRegistry src', 'Get-Content package.json', 'git status']) {
    assert.equal(classifyCommandRisk(command), 'read-only', command);
  }
});
