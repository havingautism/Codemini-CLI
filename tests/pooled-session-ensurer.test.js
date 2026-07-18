import test from 'node:test';
import assert from 'node:assert/strict';

import { createPooledSessionEnsurer } from '../codemini-web/lib/pooled-session-ensurer.js';

test('pooled session ensurer deduplicates concurrent loads and uses the pool fast path', async () => {
  let loads = 0;
  let release;
  const entries = new Map();
  const pool = {
    entries,
    async ensureSession({ sessionId, projectDir }) {
      const entry = { sessionId, projectDir, bridge: {} };
      entries.set(sessionId, entry);
      return entry;
    },
  };
  const ensure = createPooledSessionEnsurer({
    pool,
    loadSession: async (sessionId) => {
      loads += 1;
      await new Promise((resolve) => { release = resolve; });
      return { id: sessionId, projectDir: 'E:\\repo' };
    },
    resolveProjectDir: (session) => session.projectDir,
  });

  const first = ensure('session-a');
  const second = ensure('session-a');
  assert.equal(loads, 1);
  release();
  assert.equal(await first, await second);

  await ensure('session-a');
  assert.equal(loads, 1);
});
