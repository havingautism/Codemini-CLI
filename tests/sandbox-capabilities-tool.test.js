import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

async function readTools() {
  return fs.readFile('src/core/tools.js', 'utf8');
}

test('sandbox capabilities module is wired into tools.js', async () => {
  const source = await readTools();
  assert.match(source, /from "\.\/sandbox-capabilities\.js"/);
  assert.match(source, /resolveSandboxCapabilitySummary/);
  assert.match(source, /SANDBOX_CAPABILITY_COMMANDS/);
});

test('Bash tool description carries sandbox capability guidance', async () => {
  const source = await readTools();
  // The run-tool description should tell the agent to verify guest commands.
  assert.match(source, /sandboxCapabilityNote/);
  assert.match(source, /command -v <tool>/);
  assert.match(source, /sandbox commands:/);
});

test('capability summary is computed only in the run/shell path, not in retrieval tools', async () => {
  const source = await readTools();
  // import (1) + runCommand call (1). If retrieval/search handlers called it,
  // the count would rise — keep this as a guard so search never reads it.
  const occurrences = source.match(/resolveSandboxCapabilitySummary/g) || [];
  assert.equal(occurrences.length, 2);
});

test('host PowerShell escalation does not probe or display guest capabilities', async () => {
  const source = await readTools();
  assert.match(
    source,
    /const sandboxCapabilities = hostPowerShellEscalation\s*\? ""\s*:\s*await resolveSandboxCapabilitySummary/,
  );
});

test('the embedded ripgrep search path does not depend on sandbox capabilities', async () => {
  const source = await readTools();
  const searchStart = source.indexOf('async function runRipgrepSearch');
  const searchEnd = source.indexOf('async function builtinGrep');
  assert.ok(searchStart >= 0, 'runRipgrepSearch should exist');
  assert.ok(searchEnd >= searchStart, 'runRipgrepSearch should precede builtinGrep');
  const searchBlock = source.slice(searchStart, searchEnd);
  assert.doesNotMatch(searchBlock, /sandboxCapabilities|sandboxCapabilityNote|SANDBOX_CAPABILITY_COMMANDS/);
});
