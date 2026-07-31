import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchResearchSession,
  fetchResearchSessions,
} from '../codemini-web/client/src/hooks/use-api.js';

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
