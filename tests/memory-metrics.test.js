import test from 'node:test';
import assert from 'node:assert/strict';

import { createExperienceTracker } from '../src/core/memory-experience-tracker.js';
import { getMemoryMetrics } from '../src/core/memory-metrics.js';
import { archiveEntry, captureToInbox, promoteMemory, rememberMemory } from '../src/core/memory-store.js';
import { confirmRetrievedMemories, retrieveMemories } from '../src/core/memory-retriever.js';
import { dbForScope } from '../src/core/memory-sqlite-store.js';
import { withMemoryEnv } from './helpers/memory-env.js';

test('retrieval, fallback, rebuild, confirmation, candidate, and archive metrics persist locally', async () => {
  await withMemoryEnv(async (dir) => {
    const config = { memory: { max_items_per_scope: 20, retrieval: { min_score: 0 } } };
    const memory = await rememberMemory({
      scope: 'project', family: 'coding', kind: 'lesson',
      content: 'PowerShell uses pwsh for scripts', workspaceRoot: dir, config
    });
    const hits = await retrieveMemories({ query: 'PowerShell scripts', scope: 'project', workspaceRoot: dir, config });
    await retrieveMemories({ query: 'completely absent phrase', scope: 'project', workspaceRoot: dir, config });
    confirmRetrievedMemories(hits, dir);

    const db = dbForScope('project', dir);
    db.exec('DROP TABLE memory_fts');
    await retrieveMemories({
      query: 'PowerShell scripts', scope: 'project', workspaceRoot: dir,
      config: { memory: { retrieval: { min_score: 0 }, index: { rebuild_on_corruption: false, substring_fallback: true } } }
    });
    await retrieveMemories({ query: 'PowerShell scripts', scope: 'project', workspaceRoot: dir, config });

    const candidate = await captureToInbox({
      scope: 'project', type: 'lesson', summary: 'candidate metric',
      details: 'candidate metric details', projectDir: dir
    });
    await archiveEntry(candidate, 'noise');
    const promotionCandidate = await captureToInbox({
      scope: 'project', type: 'convention', summary: 'promotion metric',
      details: 'Run npm test before handoff', projectDir: dir
    });
    await promoteMemory({
      entry: promotionCandidate,
      scope: 'project',
      workspaceRoot: dir,
      config
    });

    const metrics = getMemoryMetrics({ scope: 'project', workspaceRoot: dir });
    assert.equal(metrics.memory_total, 2);
    assert.ok(metrics.retrieval_hits >= 3);
    assert.equal(metrics.retrieval_misses, 1);
    assert.equal(metrics.confirmation_count, 1);
    assert.equal(metrics.fts_fallback_count, 1);
    assert.equal(metrics.index_rebuild_count, 1);
    assert.equal(metrics.candidate_count, 2);
    assert.equal(metrics.archive_count, 1);
    assert.equal(metrics.promotion_count, 1);
    assert.equal(memory.id, hits[0].id);
  });
});

test('experience lifecycle records episode, recovery, verification, reuse, and lesson metrics', async () => {
  await withMemoryEnv(async (dir) => {
    const recalled = await rememberMemory({
      scope: 'project', family: 'coding', kind: 'lesson',
      content: 'Use node for widget verification', workspaceRoot: dir,
      config: { memory: { max_items_per_scope: 20 } }
    });
    const tracker = createExperienceTracker({
      sessionId: 'metrics-session', workspaceRoot: dir,
      config: { memory: { experience: { enabled: true, writeback_on_recovery: true, require_verification: true } } }
    });
    tracker.noteRecovery([recalled]);
    tracker.recordAttempt({ tool: 'Bash', args: { command: 'npm test widget' }, result: 'failure', error: 'failed' });
    tracker.recordAttempt({ tool: 'Bash', args: { command: 'node verify widget' }, result: 'success' });
    tracker.noteVerification({ type: 'test_exit_zero' });
    const flushed = await tracker.flush();
    assert.equal(flushed.ok, true);

    const metrics = getMemoryMetrics({ scope: 'project', workspaceRoot: dir });
    assert.equal(metrics.experience_episode_count, 1);
    assert.equal(metrics.experience_recovery_count, 1);
    assert.equal(metrics.experience_verified_count, 1);
    assert.equal(metrics.lesson_generated_count, 1);
    assert.equal(metrics.lesson_reused_count, 1);
    assert.equal(metrics.confirmation_count, 1);
    assert.equal(metrics.candidate_count, 1);
  });
});
