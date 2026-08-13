import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveCodeWikiBridge } from '../codemini-web/lib/codewiki-bridge.js';
import { RuntimeBridge } from '../codemini-web/lib/runtime-bridge.js';

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
    currentSessionId: 'sess-current',
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
  assert.equal(result.sessionId, 'sess-current');
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

test('resolveCodeWikiBridge does not reuse a session queued in the runtime pool', async () => {
  const current = makeBridge(false);
  const preferred = makeBridge(false);
  const createdBridge = makeBridge(false);
  const result = await resolveCodeWikiBridge({
    codeWikiProjectDir: '/repo/a',
    currentProjectDir: '/repo/b',
    currentBridge: current,
    ensurePooledSession: async (sessionId) => ({
      bridge: sessionId === 'sess-preferred' ? preferred : createdBridge,
    }),
    createSession: async () => ({ id: 'sess-new' }),
    findPreferredSessionId: async () => 'sess-preferred',
    sameProject: (left, right) => left === right,
    isSessionBusy: (sessionId) => sessionId === 'sess-preferred',
  });
  assert.equal(result.bridge, createdBridge);
  assert.equal(result.source, 'created');
  assert.equal(result.sessionId, 'sess-new');
});

test('RuntimeBridge starts CodeWiki generation asynchronously and forwards useful progress', async () => {
  let finish;
  const events = [];
  const runtime = {
    getCurrentSessionId: () => 'codewiki-session',
    getRuntimeState: () => ({}),
    setRequestToolApproval() {},
    setRequestUserInput() {},
    setOnTitleUpdate() {},
    setOnTitleStatus() {},
    submitCodeWiki(_line, onEvent) {
      onEvent({ type: 'step:start', step: 2 });
      onEvent({ type: 'tool:start', name: 'read', displayName: 'Read file' });
      onEvent({ type: 'tool:end', name: 'read', displayName: 'Read file', summary: 'Read src/core/chat-runtime.js' });
      return new Promise((resolve) => { finish = resolve; });
    },
  };
  const bridge = new RuntimeBridge(runtime, {
    sessionId: 'codewiki-session',
    onEvent: (event) => events.push(event),
  });

  assert.deepEqual(
    bridge.handleCodeWikiGenerate('/project-requirements --fast --html', {
      operationId: 'codewiki-operation-1',
    }),
    { accepted: true },
  );
  assert.equal(bridge.getState().codeWikiGenerating, true);
  assert.deepEqual(
    events
      .filter((event) => event.type === 'codewiki:generate_progress')
      .map((event) => [event.operationId, event.phase, event.summary || event.title]),
    [
      ['codewiki-operation-1', 'preparing', 'Generate project requirements report'],
      ['codewiki-operation-1', 'agent_step', 'Analyzing project (round 2)'],
      ['codewiki-operation-1', 'tool_start', 'Running Read file'],
      ['codewiki-operation-1', 'tool_end', 'Read src/core/chat-runtime.js'],
    ],
  );

  finish({ type: 'assistant', text: 'done' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(bridge.getState().codeWikiGenerating, false);
  assert.equal(
    events.find((event) => event.type === 'codewiki:generate_done')?.operationId,
    'codewiki-operation-1',
  );
});
