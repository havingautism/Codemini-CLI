import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { rememberMemory, listMemories, replaceMemoryBucket, listInbox } from '../src/core/memory-store.js';
import { recordRetrievedOutcome, confirmRetrievedMemories } from '../src/core/memory-retriever.js';
import { withMemoryEnv } from './helpers/memory-env.js';

const STORE_CONFIG = { memory: { max_items_per_scope: 50, max_prompt_chars: 8000 } };

test('retrieved success and failure update counts, utility, and lifecycle', async () => {
  await withMemoryEnv(async (dir) => {
    const saved = await rememberMemory({
      scope: 'project',
      kind: 'lesson',
      family: 'coding',
      content: 'Use node instead of pnpm exec tsx',
      summary: 'node not tsx',
      workspaceRoot: dir,
      config: STORE_CONFIG
    });
    recordRetrievedOutcome([saved], 'success', dir);
    recordRetrievedOutcome([saved], 'success', dir);
    recordRetrievedOutcome([saved], 'success', dir);
    const [afterSuccess] = await listMemories({ scope: 'project', workspaceRoot: dir });
    assert.equal(afterSuccess.successCount, 3);
    assert.equal(afterSuccess.lifecycle, 'operational');
    assert.ok(afterSuccess.utilityScore > 0.5);

    recordRetrievedOutcome([afterSuccess], 'failure', dir);
    recordRetrievedOutcome([afterSuccess], 'failure', dir);
    recordRetrievedOutcome([afterSuccess], 'failure', dir);
    const [afterFailure] = await listMemories({ scope: 'project', workspaceRoot: dir });
    assert.equal(afterFailure.failureCount, 3);
    assert.equal(afterFailure.lifecycle, 'archived');
    assert.ok(afterFailure.utilityScore < 0.5);
  });
});

test('Dream bucket replace keeps reinforcement counts for the same fact', async () => {
  await withMemoryEnv(async (dir) => {
    const saved = await rememberMemory({
      scope: 'global',
      kind: 'lesson',
      content: 'PowerShell uses . instead of source',
      summary: 'PowerShell dot source',
      semanticKey: 'powershell:source',
      workspaceRoot: dir,
      config: STORE_CONFIG
    });
    recordRetrievedOutcome([saved], 'success', dir);
    recordRetrievedOutcome([saved], 'success', dir);
    await replaceMemoryBucket({
      scope: 'global',
      workspaceRoot: dir,
      items: [{
        kind: 'lesson',
        content: 'PowerShell uses . instead of source',
        summary: 'PowerShell dot source',
        semanticKey: 'powershell:source',
        lifecycle: 'operational'
      }]
    });
    const [kept] = await listMemories({ scope: 'global', workspaceRoot: dir });
    assert.equal(kept.successCount, 2);
  });
});

test('tool failure recalls coding memory after execute, not before every call', async () => {
  const source = await fs.readFile(new URL('../src/core/agent-loop.js', import.meta.url), 'utf8');
  const executeAt = source.indexOf('await toolRuntime.execute(toolName');
  assert.ok(executeAt > 0);
  assert.equal(source.slice(Math.max(0, executeAt - 700), executeAt).includes('retrieveMemories'), false);
  assert.match(source, /renderRecoveryMemory/);
  assert.match(source, /mode:\s*['"]failure['"]/);
});

test('three confirmations promote a lesson to longterm', async () => {
  await withMemoryEnv(async (dir) => {
    const saved = await rememberMemory({
      scope: 'project',
      kind: 'lesson',
      family: 'coding',
      content: 'Use node instead of pnpm exec tsx',
      summary: 'node not tsx',
      workspaceRoot: dir,
      config: STORE_CONFIG
    });
    assert.equal(saved.lifecycle, 'operational');
    confirmRetrievedMemories([saved], dir);
    confirmRetrievedMemories([saved], dir);
    confirmRetrievedMemories([saved], dir);
    const [after] = await listMemories({ scope: 'project', workspaceRoot: dir });
    assert.equal(after.confirmationCount, 3);
    assert.equal(after.lifecycle, 'longterm');
    assert.ok(after.lastConfirmedAt);
  });
});

test('content update bumps revision and keeps confirmation count', async () => {
  await withMemoryEnv(async (dir) => {
    const saved = await rememberMemory({
      scope: 'global',
      kind: 'lesson',
      content: 'PowerShell uses . instead of source',
      summary: 'PowerShell dot source',
      semanticKey: 'powershell:source',
      workspaceRoot: dir,
      config: STORE_CONFIG
    });
    confirmRetrievedMemories([saved], dir);
    await rememberMemory({
      scope: 'global',
      kind: 'lesson',
      content: 'PowerShell uses . instead of source for scripts',
      summary: 'PowerShell dot source',
      semanticKey: 'powershell:source',
      workspaceRoot: dir,
      config: STORE_CONFIG
    });
    const [kept] = await listMemories({ scope: 'global', workspaceRoot: dir });
    assert.equal(kept.confirmationCount, 1);
    assert.ok(kept.revision >= 2);
  });
});

test('fork save_memory writes an inbox candidate instead of durable memory', async () => {
  await withMemoryEnv(async (dir) => {
    const { getBuiltinTools } = await import('../src/core/tools.js');
    const { handlers } = getBuiltinTools({
      workspaceRoot: dir,
      config: { memory: { candidate_writes: true, max_items_per_scope: 50 } }
    });
    const result = await handlers.save_memory({
      scope: 'project',
      kind: 'note',
      content: 'Branch-only observation about tsx'
    });
    assert.equal(result.candidate, true);
    const durable = await listMemories({ scope: 'project', workspaceRoot: dir });
    assert.equal(durable.length, 0);
    const inbox = await listInbox();
    assert.equal(inbox.length, 1);
    assert.match(inbox[0].details || inbox[0].summary, /tsx/);
  });
});

