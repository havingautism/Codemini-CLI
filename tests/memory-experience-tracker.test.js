import test from 'node:test';
import assert from 'node:assert/strict';
import { createExperienceTracker } from '../src/core/memory-experience-tracker.js';
import { listInbox, listMemories, rememberMemory } from '../src/core/memory-store.js';
import { withMemoryEnv } from './helpers/memory-env.js';

const CFG = { memory: { experience: { enabled: true, writeback_on_recovery: true, max_attempts_per_episode: 6 } } };

test('verified episode writes a coding inbox candidate with verified evidence', async () => {
  await withMemoryEnv(async (dir) => {
    const tracker = createExperienceTracker({ sessionId: 'sess-1', workspaceRoot: dir, config: CFG });
    tracker.recordAttempt({ tool: 'run', args: { command: 'pnpm exec tsx foo.ts' }, result: 'failure', error: 'command not found' });
    tracker.recordAttempt({ tool: 'run', args: { command: 'node foo.js' }, result: 'success' });
    tracker.noteVerification({ type: 'test_exit_zero' });
    const written = await tracker.flush();
    assert.equal(written?.ok, true);
    const inbox = await listInbox();
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].type, 'lesson');
    assert.equal(inbox[0].family, 'coding');
    assert.equal(inbox[0].evidence?.verified, true);
    assert.equal(inbox[0].evidence?.successful_recovery, true);
  });
});

test('recovered but unverified episode does not write a lesson', async () => {
  await withMemoryEnv(async (dir) => {
    const tracker = createExperienceTracker({ sessionId: 'sess-2', workspaceRoot: dir, config: CFG });
    tracker.recordAttempt({ tool: 'run', args: { command: 'pnpm exec tsx foo.ts' }, result: 'failure', error: 'command not found' });
    tracker.recordAttempt({ tool: 'run', args: { command: 'node foo.js' }, result: 'success' });
    const written = await tracker.flush();
    assert.equal(written, null);
    assert.equal((await listInbox()).length, 0);
  });
});

test('verification confirms retrieved coding lessons', async () => {
  await withMemoryEnv(async (dir) => {
    const saved = await rememberMemory({
      scope: 'project', kind: 'lesson', family: 'coding',
      content: 'Use node instead of pnpm exec tsx', summary: 'node not tsx',
      workspaceRoot: dir, config: { memory: { max_items_per_scope: 50 } }
    });
    const tracker = createExperienceTracker({ sessionId: 'sess-confirm', workspaceRoot: dir, config: CFG });
    tracker.recordAttempt({ tool: 'run', args: { command: 'pnpm exec tsx foo.ts' }, result: 'failure', error: 'command not found' });
    tracker.noteRecovery([saved]);
    tracker.recordAttempt({ tool: 'run', args: { command: 'node foo.js' }, result: 'success' });
    tracker.noteVerification();
    const [after] = await listMemories({ scope: 'project', workspaceRoot: dir });
    assert.equal(after.confirmationCount, 1);
    assert.ok(after.lastConfirmedAt);
  });
});

test('raw command-not-found without recovery writes nothing', async () => {
  await withMemoryEnv(async (dir) => {
    const tracker = createExperienceTracker({ sessionId: 'sess-3', workspaceRoot: dir, config: CFG });
    tracker.recordAttempt({ tool: 'run', args: { command: 'pnpm exec tsx foo.ts' }, result: 'failure', error: 'command not found' });
    const written = await tracker.flush();
    assert.equal(written, null);
    assert.equal((await listInbox()).length, 0);
  });
});

test('same-command retry then success needs verification before writing', async () => {
  await withMemoryEnv(async (dir) => {
    const tracker = createExperienceTracker({ sessionId: 'sess-4', workspaceRoot: dir, config: CFG });
    tracker.recordAttempt({ tool: 'run', args: { command: 'pnpm exec tsx foo.ts' }, result: 'failure', error: 'command not found' });
    tracker.recordAttempt({ tool: 'run', args: { command: 'pnpm exec tsx foo.ts' }, result: 'failure', error: 'command not found' });
    tracker.recordAttempt({ tool: 'run', args: { command: 'node foo.js' }, result: 'success' });
    const written = await tracker.flush();
    assert.equal(written, null);
  });
});
