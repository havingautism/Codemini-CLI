import test from 'node:test';
import assert from 'node:assert/strict';

import { getMemoryMetrics } from '../src/core/memory-metrics.js';
import { listMemories, rememberMemory } from '../src/core/memory-store.js';
import { retrieveMemories } from '../src/core/memory-retriever.js';
import { withMemoryEnv } from './helpers/memory-env.js';

test('capacity archives the lowest-retention active memory and protects pinned records', async () => {
  await withMemoryEnv(async (dir) => {
    const config = { memory: { max_items_per_scope: 2, max_project_chars: 5000, retrieval: { min_score: 0 } } };
    const cold = await rememberMemory({
      scope: 'project', kind: 'note', content: 'Cold transient project note',
      confidence: 0.5, workspaceRoot: dir, config
    });
    const pinned = await rememberMemory({
      scope: 'project', kind: 'convention', content: 'Never auto-commit changes',
      confidence: 0.5, pinned: true, workspaceRoot: dir, config
    });
    const hot = await rememberMemory({
      scope: 'project', kind: 'lesson', content: 'Run npm test before handoff',
      confidence: 0.95, workspaceRoot: dir, config
    });

    const items = await listMemories({ scope: 'project', workspaceRoot: dir });
    assert.equal(items.filter((item) => item.lifecycle !== 'archived').length, 2);
    assert.equal(items.find((item) => item.id === cold.id).lifecycle, 'archived');
    assert.notEqual(items.find((item) => item.id === pinned.id).lifecycle, 'archived');
    assert.notEqual(items.find((item) => item.id === hot.id).lifecycle, 'archived');
    assert.equal(items.find((item) => item.id === cold.id).evidence.retentionEviction.reason, 'capacity');

    const recalled = await retrieveMemories({ query: 'Cold transient', scope: 'project', workspaceRoot: dir, config });
    assert.equal(recalled.some((item) => item.id === cold.id), false);
    const metrics = getMemoryMetrics({ scope: 'project', workspaceRoot: dir });
    assert.equal(metrics.memory_total, 3);
    assert.equal(metrics.active_memory_total, 2);
    assert.equal(metrics.archived_memory_total, 1);
    assert.equal(metrics.eviction_count, 1);
    assert.equal(metrics.invalidated_memory_count, 1);
  });
});
