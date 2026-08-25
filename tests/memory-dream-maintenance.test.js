import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { applyMemoryMaintenancePlan, runDreamConsolidation } from '../src/core/dream-consolidate.js';
import { parseMaintenanceResult } from '../src/core/dream-evaluator.js';
import { listMemories, replaceMemoryBucket } from '../src/core/memory-store.js';
import { withMemoryEnv } from './helpers/memory-env.js';

test('structured Dream maintenance parser normalizes all lifecycle action sections', () => {
  const parsed = parseMaintenanceResult(JSON.stringify({
    promotions: [],
    staleness: [{ memory_id: 'stale', action: 'extend', extend_days: 90 }],
    consolidations: [{
      source_ids: ['a', 'b'],
      result: { kind: 'lesson', content: 'Use npm on this project.', summary: 'Use npm', semantic_key: 'package-manager' }
    }],
    archives: [{ memory_id: 'old', reason: 'superseded' }]
  }));

  assert.deepEqual(parsed.staleness, [{ memoryId: 'stale', action: 'extend', extendDays: 90 }]);
  assert.deepEqual(parsed.consolidations[0].sourceIds, ['a', 'b']);
  assert.equal(parsed.consolidations[0].result.semanticKey, 'package-manager');
  assert.deepEqual(parsed.archives, [{ memoryId: 'old', reason: 'superseded' }]);
});

test('maintenance actions preserve evidence and protect pinned or unknown memories', () => {
  const source = [
    { id: 'a', scope: 'project', family: 'coding', kind: 'lesson', content: 'npm test checks runtime', evidence: { command: 'npm test' }, tags: ['test'], successCount: 2 },
    { id: 'b', scope: 'project', family: 'coding', kind: 'lesson', content: 'npm run build:web checks UI', evidence: { command: 'npm run build:web' }, tags: ['build'], confirmationCount: 1 },
    { id: 'stale', scope: 'project', kind: 'note', content: 'Node 22 is installed', expectedValidDays: 30 },
    { id: 'pinned', scope: 'project', kind: 'convention', content: 'Never push automatically', pinned: true }
  ];
  const result = applyMemoryMaintenancePlan(source, {
    staleness: [{ memoryId: 'stale', action: 'extend', extendDays: 90 }],
    consolidations: [{
      sourceIds: ['a', 'b'],
      result: { kind: 'lesson', content: 'Run npm test and npm run build:web.', summary: 'Verify runtime and UI' }
    }],
    archives: [
      { memoryId: 'pinned', reason: 'noise' },
      { memoryId: 'unknown', reason: 'noise' }
    ]
  });

  assert.equal(result.items.some((item) => item.id === 'a' || item.id === 'b'), false);
  assert.equal(result.items.find((item) => item.id === 'stale').expectedValidDays, 120);
  assert.ok(result.items.some((item) => item.id === 'pinned'));
  const consolidated = result.items.find((item) => item.source === 'dream-consolidation');
  assert.deepEqual(consolidated.evidence.sourceMemoryIds, ['a', 'b']);
  assert.deepEqual(consolidated.tags.sort(), ['build', 'test']);
  assert.equal(consolidated.successCount, 2);
  assert.equal(consolidated.confirmationCount, 1);
  assert.equal(result.applied.archives.length, 0);
});

test('Scenario G: Dream extends a stale memory through the persisted maintenance path', async () => {
  await withMemoryEnv(async (dir) => {
    await replaceMemoryBucket({
      scope: 'project',
      workspaceRoot: dir,
      items: [{
        id: 'stale-memory',
        scope: 'project',
        family: 'repo',
        kind: 'convention',
        content: 'Use Node 22 for this repository.',
        summary: 'Node 22',
        expectedValidDays: 30,
        updatedAt: '2025-01-01T00:00:00.000Z'
      }]
    });

    let requestBody = null;
    const server = http.createServer(async (request, response) => {
      let raw = '';
      for await (const chunk of request) raw += chunk;
      requestBody = JSON.parse(raw);
      const content = JSON.stringify({
        promotions: [],
        staleness: [{ memory_id: 'stale-memory', action: 'extend', extend_days: 90 }],
        consolidations: [],
        archives: []
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = server.address().port;
      const report = await runDreamConsolidation({
        scope: 'project',
        workspaceRoot: dir,
        writeAudit: false,
        config: {
          sdk: { provider: 'openai-compatible' },
          gateway: { base_url: `http://127.0.0.1:${port}/v1`, api_key: 'test' },
          model: { name: 'test-model' },
          memory: { lifecycle: { staleness_review: true } },
          ui: { reply_language: 'en' }
        }
      });
      const [memory] = await listMemories({ scope: 'project', workspaceRoot: dir });
      assert.equal(report.ok, true);
      assert.equal(report.maintenance[0].staleness[0].memoryId, 'stale-memory');
      assert.equal(memory.expectedValidDays, 120);
      assert.match(requestBody.messages.at(-1).content, /"stale": true/);
    } finally {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
