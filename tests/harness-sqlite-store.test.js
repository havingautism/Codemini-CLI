import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getGlobalDatabase, closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import { createHarnessSqliteStore } from '../src/core/harness/audit/harness-sqlite-store.js';
import { withCodeminiGlobalDir } from './helpers/codemini-global-dir.js';

test('harness sqlite store persists an episode and ordered redacted events', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-harness-'));
  try {
    await withCodeminiGlobalDir(dir, async () => {
      const store = createHarnessSqliteStore({ db: getGlobalDatabase() });
      store.createEpisode({ id: 'episode-1', sessionId: 'session-1' });
      store.appendEvent({ episodeId: 'episode-1', step: 1, type: 'tool:result', payload: { secret: 'hide', ok: true } });
      store.appendEvent({ episodeId: 'episode-1', step: 2, type: 'step:end', payload: { done: true } });
      store.finishEpisode('episode-1', { status: 'completed', outcome: 'ok' });
      const events = store.listEpisodeEvents('episode-1');
      assert.equal(events.length, 2);
      assert.equal(events[0].payload.secret, '[redacted]');
      assert.equal(events[1].step, 2);
      const row = getGlobalDatabase().prepare('SELECT status FROM harness_episodes WHERE id = ?').get('episode-1');
      assert.equal(row.status, 'completed');
    });
  } finally {
    closeSqliteDatabasesForTests(path.basename(dir));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
