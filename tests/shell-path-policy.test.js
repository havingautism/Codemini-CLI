import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectShellCommandPaths } from '../src/core/shell-path-policy.js';

test('Bash path policy distinguishes devices, globs, and real outside paths', () => {
  const root = '/home/user/app';
  const safe = inspectShellCommandPaths({
    command: 'find /home/user/app -not -path "*/node_modules/*" 2>/dev/null',
    shell: 'bash',
    workspaceRoot: root,
    allowedRoots: [root],
  });
  assert.deepEqual(safe.outside, []);
  assert.ok(safe.candidates.some((candidate) => candidate.kind === 'special' && candidate.value === '/dev/null'));

  const outside = inspectShellCommandPaths({
    command: 'echo nope >/tmp/outside.txt; find /var/log/* -type f',
    shell: 'bash',
    workspaceRoot: root,
    allowedRoots: [root],
  }).outside;
  assert.deepEqual(outside.map((candidate) => candidate.value), ['/tmp/outside.txt', '/var/log/*']);
});

test('PowerShell path policy uses Windows drive and relative path semantics', () => {
  const root = 'E:\\Projects\\App';
  const inspection = inspectShellCommandPaths({
    command: 'Get-Content "E:\\Projects\\App\\src\\a.js"; Set-Content ..\\outside.txt; Get-Content "C:\\Temp\\x.txt"; echo ok > NUL',
    shell: 'powershell',
    workspaceRoot: root,
    allowedRoots: [root],
  });
  assert.deepEqual(
    inspection.outside.map((candidate) => candidate.value),
    ['..\\outside.txt', 'C:\\Temp\\x.txt'],
  );
  assert.ok(inspection.candidates.some((candidate) => candidate.kind === 'special' && candidate.value === 'NUL'));
});

test('PowerShell path policy does not treat regex operands as rooted paths', () => {
  const root = 'E:\\Projects\\App';
  const inspection = inspectShellCommandPaths({
    command: "Get-ChildItem src -Recurse | Where-Object { $_.FullName -notmatch '\\.venv' }",
    shell: 'powershell',
    workspaceRoot: root,
    allowedRoots: [root],
  });

  assert.deepEqual(inspection.outside, []);
  assert.ok(inspection.candidates.some((candidate) => candidate.kind === 'literal' && candidate.value === '\\.venv'));
});
