import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchResearchSession,
  fetchResearchSessions,
} from '../codemini-web/client/src/hooks/use-api.js';
import fs from 'node:fs/promises';
import { listResearchSessionsForApi } from '../codemini-web/lib/research-service.js';
import {
  createResearchSession,
  updateResearchSession,
} from '../src/core/research-store.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import os from 'node:os';
import path from 'node:path';

test('research client helpers reject non-success responses', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: true, message: 'research session not found' }),
    { status: 404, headers: { 'Content-Type': 'application/json' } },
  );
  try {
    await assert.rejects(
      fetchResearchSession('missing'),
      /research session not found/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('research list requests forward abort signals', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let receivedSignal = null;
  globalThis.fetch = async (_url, options = {}) => {
    receivedSignal = options.signal;
    return new Response(JSON.stringify({ sessions: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    await fetchResearchSessions('query', { signal: controller.signal });
    assert.equal(receivedSignal, controller.signal);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('research list summaries expose generated titles to library cards', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-research-title-'));
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = dir;
  closeSqliteDatabasesForTests();
  try {
    const session = createResearchSession({ question: 'City Pop history' });
    updateResearchSession(session.id, {
      plan: { title: '🎵 City Pop 前世今生', depth: 'brief', questions: [] },
    });
    const listed = listResearchSessionsForApi().sessions.find((item) => item.id === session.id);
    assert.equal(listed.title, '🎵 City Pop 前世今生');
  } finally {
    closeSqliteDatabasesForTests();
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
  }
});
