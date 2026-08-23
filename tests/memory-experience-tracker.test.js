import test from 'node:test';
import assert from 'node:assert/strict';
import { createExperienceTracker } from '../src/core/memory-experience-tracker.js';
import { listInbox } from '../src/core/memory-store.js';
import { withMemoryEnv } from './helpers/memory-env.js';

test('Case B: failed then recovered tool attempts write a coding inbox candidate', async () => {
  await withMemoryEnv(async (dir) => {
    const tracker = createExperienceTracker({
      sessionId: 'sess-1',
      workspaceRoot: dir,
      config: { memory: { experience: { enabled: true, writeback_on_recovery: true, max_attempts_per_episode: 6 } } }
    });
    tracker.recordAttempt({
      tool: 'run',
      args: { command: 'pnpm exec tsx foo.ts' },
      result: 'failure',
      error: 'pnpm exec tsx: command not found'
    });
    tracker.recordAttempt({
      tool: 'run',
      args: { command: 'node foo.js' },
      result: 'success'
    });
    const written = await tracker.flush();
    assert.equal(written?.ok, true);
    const inbox = await listInbox();
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].type, 'lesson');
    assert.equal(inbox[0].family, 'coding');
    assert.match(inbox[0].summary, /tsx|node foo/i);
    assert.equal(inbox[0].evidence?.successful_recovery, true);
  });
});

test('Case C: raw command-not-found without recovery does not write durable or inbox memory', async () => {
  await withMemoryEnv(async (dir) => {
    const tracker = createExperienceTracker({
      sessionId: 'sess-2',
      workspaceRoot: dir,
      config: { memory: { experience: { enabled: true, writeback_on_recovery: true } } }
    });
    tracker.recordAttempt({
      tool: 'run',
      args: { command: 'pnpm exec tsx foo.ts' },
      result: 'failure',
      error: 'command not found'
    });
    const written = await tracker.flush();
    assert.equal(written, null);
    const inbox = await listInbox();
    assert.equal(inbox.length, 0);
  });
});
