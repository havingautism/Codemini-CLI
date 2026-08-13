import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteSkill } from '../codemini-web/client/src/hooks/use-api.js';

test('deleteSkill uses the single global installation endpoint', async () => {
  const previousFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return { json: async () => ({ ok: true }) };
  };
  try {
    await deleteSkill('shared-name');
  } finally {
    globalThis.fetch = previousFetch;
  }

  const url = new URL(request.url, 'http://codemini.local');
  assert.equal(request.options.method, 'DELETE');
  assert.equal(url.pathname, '/api/skills/shared-name');
  assert.equal(url.search, '');
});
