import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveCodeWikiBridge } from '../codemini-web/lib/codewiki-bridge.js';

function makeBridge(busy = false) {
  return {
    busy,
    isBusy() { return this.busy; },
  };
}

test('resolveCodeWikiBridge reuses current bridge when idle on same project', async () => {
  const current = makeBridge(false);
  let created = 0;
  let ensured = 0;
  const result = await resolveCodeWikiBridge({
    codeWikiProjectDir: '/repo/a',
    currentProjectDir: '/repo/a',
    currentBridge: current,
    ensurePooledSession: async () => {
      ensured += 1;
      return { bridge: makeBridge(false) };
    },
    createSession: async () => {
      created += 1;
      return { id: 'new' };
    },
    findPreferredSessionId: async () => 'preferred',
    sameProject: (left, right) => left === right,
  });
  assert.equal(result.bridge, current);
  assert.equal(result.source, 'current');
  assert.equal(created, 0);
  assert.equal(ensured, 0);
});

test('resolveCodeWikiBridge prefers an idle existing project session when current differs', async () => {
  const current = makeBridge(false);
  const preferred = makeBridge(false);
  let created = 0;
  const result = await resolveCodeWikiBridge({
    codeWikiProjectDir: '/repo/codewiki',
    currentProjectDir: '/repo/general',
    currentBridge: current,
    ensurePooledSession: async (sessionId) => {
      assert.equal(sessionId, 'sess-preferred');
      return { bridge: preferred };
    },
    createSession: async () => {
      created += 1;
      return { id: 'new' };
    },
    findPreferredSessionId: async (dir) => {
      assert.equal(dir, '/repo/codewiki');
      return 'sess-preferred';
    },
    sameProject: (left, right) => left === right,
  });
  assert.equal(result.bridge, preferred);
  assert.equal(result.source, 'preferred');
  assert.equal(result.sessionId, 'sess-preferred');
  assert.equal(created, 0);
});

test('resolveCodeWikiBridge creates a dedicated session when preferred is busy', async () => {
  const current = makeBridge(true);
  const preferredBusy = makeBridge(true);
  const createdBridge = makeBridge(false);
  let created = 0;
  const result = await resolveCodeWikiBridge({
    codeWikiProjectDir: '/repo/a',
    currentProjectDir: '/repo/a',
    currentBridge: current,
    ensurePooledSession: async (sessionId) => {
      if (sessionId === 'sess-preferred') return { bridge: preferredBusy };
      assert.equal(sessionId, 'sess-new');
      return { bridge: createdBridge };
    },
    createSession: async (dir) => {
      created += 1;
      assert.equal(dir, '/repo/a');
      return { id: 'sess-new' };
    },
    findPreferredSessionId: async () => 'sess-preferred',
    sameProject: (left, right) => left === right,
  });
  assert.equal(result.bridge, createdBridge);
  assert.equal(result.source, 'created');
  assert.equal(created, 1);
});

test('resolveCodeWikiBridge creates when no preferred session exists', async () => {
  const current = makeBridge(false);
  const createdBridge = makeBridge(false);
  const result = await resolveCodeWikiBridge({
    codeWikiProjectDir: '/repo/codewiki',
    currentProjectDir: '/repo/general',
    currentBridge: current,
    ensurePooledSession: async (sessionId) => {
      assert.equal(sessionId, 'sess-new');
      return { bridge: createdBridge };
    },
    createSession: async () => ({ id: 'sess-new' }),
    findPreferredSessionId: async () => null,
    sameProject: (left, right) => left === right,
  });
  assert.equal(result.bridge, createdBridge);
  assert.equal(result.source, 'created');
});
