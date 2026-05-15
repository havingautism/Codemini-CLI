import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadConfig } from '../src/core/config-store.js';
import { runDreamConsolidation } from '../src/core/dream-consolidate.js';
import { getMemoryBucketMaintenance, listMemories, rememberMemory } from '../src/core/memory-store.js';

async function withTempConfigDir(run) {
  const prev = process.env.CODEMINI_GLOBAL_DIR;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-global-'));
  process.env.CODEMINI_GLOBAL_DIR = dir;
  try {
    await run(dir);
  } finally {
    if (prev === undefined) {
      delete process.env.CODEMINI_GLOBAL_DIR;
    } else {
      process.env.CODEMINI_GLOBAL_DIR = prev;
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function withMockFetch(handler) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  return async () => {
    globalThis.fetch = originalFetch;
  };
}

function makeJsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

test('dream maintenance uses LLM to consolidate stale memory buckets and marks them clean', async () => {
  await withTempConfigDir(async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-dream-maintenance-'));
    let calls = 0;
    const restoreFetch = withMockFetch(async (_url, init) => {
      calls += 1;
      const body = JSON.parse(typeof init.body === 'string' ? init.body : String(init.body));
      assert.match(body.messages.at(-1).content, /Maintain this user memory bucket/);
      return makeJsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                items: [
                  {
                    kind: 'preference',
                    content: '用户偏好简洁中文回复，并希望在非代码说明中适度使用 emoji。',
                    summary: '用户偏好简洁中文和适度 emoji',
                    confidence: 0.92,
                    lifecycle: 'longterm'
                  }
                ],
                archives: [{ source_ids: ['old-a', 'old-b'], reason: 'merged' }]
              })
            }
          }
        ]
      });
    });

    try {
      const config = await loadConfig();
      config.gateway.base_url = 'https://gateway.example/v1';
      config.gateway.api_key = 'test-key';
      await rememberMemory({
        scope: 'user',
        content: '用户偏好简洁中文回复。',
        kind: 'preference',
        replaceSimilar: false,
        workspaceRoot,
        config
      });
      await rememberMemory({
        scope: 'user',
        content: '用户希望回复中适度使用 emoji。',
        kind: 'preference',
        replaceSimilar: false,
        workspaceRoot,
        config
      });

      const first = await runDreamConsolidation({
        scope: 'user',
        workspaceRoot,
        config,
        writeAudit: false
      });
      const memories = await listMemories({ scope: 'user', workspaceRoot });
      const marker = await getMemoryBucketMaintenance({ scope: 'user', workspaceRoot });

      assert.equal(first.ok, true);
      assert.equal(first.maintenance[0].scope, 'user');
      assert.equal(first.maintenance[0].before, 2);
      assert.equal(first.maintenance[0].after, 1);
      assert.equal(memories.length, 1);
      assert.match(memories[0].content, /简洁中文回复/);
      assert.match(memories[0].content, /emoji/i);
      assert.equal(marker.fresh, true);
      assert.equal(calls, 1);

      const second = await runDreamConsolidation({
        scope: 'user',
        workspaceRoot,
        config,
        writeAudit: false
      });

      assert.equal(second.maintenance[0].skipped, true);
      assert.equal(second.maintenance[0].reason, 'already-maintained');
      assert.equal(calls, 1);
    } finally {
      await restoreFetch();
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
