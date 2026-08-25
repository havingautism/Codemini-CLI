import test from 'node:test';
import assert from 'node:assert/strict';

import { dbForScope } from '../src/core/memory-sqlite-store.js';
import { rememberMemory, listMemories } from '../src/core/memory-store.js';
import { createMemoryRetrievalAdapter } from '../src/core/memory-retrieval-adapter.js';
import { expandMemoryQuery } from '../src/core/memory-query-expansion.js';
import { retrieveMemories } from '../src/core/memory-retriever.js';
import { withMemoryEnv } from './helpers/memory-env.js';

const CONFIG = { memory: { max_items_per_scope: 50, retrieval: { min_score: 0 } } };

test('FTS5 adapter owns search, remove, upsert, and rebuild index operations', async () => {
  await withMemoryEnv(async (dir) => {
    const saved = await rememberMemory({
      scope: 'project', kind: 'convention', content: 'Run npm test before handoff.',
      summary: 'npm test handoff', workspaceRoot: dir, config: CONFIG
    });
    const db = dbForScope('project', dir);
    const adapter = createMemoryRetrievalAdapter({ name: 'fts5', db });
    assert.equal((await adapter.search('npm test', { scope: 'project' }))[0].id, saved.id);

    await adapter.remove(saved.id);
    assert.equal((await adapter.search('npm test', { scope: 'project', rebuild: false })).length, 0);

    await adapter.upsert(saved);
    assert.equal((await adapter.search('npm test', { scope: 'project' }))[0].id, saved.id);
    await adapter.rebuild();
    assert.equal((await adapter.search('npm test', { scope: 'project' }))[0].id, saved.id);
  });
});

test('fallback adapter searches canonical memory without FTS', async () => {
  await withMemoryEnv(async (dir) => {
    await rememberMemory({
      scope: 'project', kind: 'lesson', content: 'PowerShell scripts use pwsh.',
      workspaceRoot: dir, config: CONFIG
    });
    const adapter = createMemoryRetrievalAdapter({ name: 'fallback', db: dbForScope('project', dir) });
    const hits = await adapter.search('PowerShell', { scope: 'project' });
    assert.equal(hits.length, 1);
  });
});

test('deterministic query expansion recalls test memory for a Chinese task', async () => {
  assert.match(expandMemoryQuery('怎么跑单测？'), /vitest/);
  await withMemoryEnv(async (dir) => {
    await rememberMemory({
      scope: 'project', family: 'procedure', kind: 'convention',
      content: 'Run vitest with npm test before handoff.', summary: 'vitest command',
      workspaceRoot: dir, config: CONFIG
    });
    const expanded = await retrieveMemories({
      query: '怎么跑单测？', scope: 'project', workspaceRoot: dir,
      config: { memory: { retrieval: { min_score: 0, query_expansion: true } } }
    });
    const literal = await retrieveMemories({
      query: '怎么跑单测？', scope: 'project', workspaceRoot: dir,
      config: { memory: { retrieval: { min_score: 0, query_expansion: false } } }
    });
    assert.equal(expanded.length, 1);
    assert.equal(literal.length, 0);
    assert.equal((await listMemories({ scope: 'project', workspaceRoot: dir }))[0].id, expanded[0].id);
  });
});
