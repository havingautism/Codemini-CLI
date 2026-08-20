import test from 'node:test';
import assert from 'node:assert/strict';

import { loadSessionForSwitch } from '../codemini-web/lib/session-switch-loader.js';

test('cold session switch returns stored history without waiting for runtime warmup', async () => {
  let finishWarmup;
  const warmup = new Promise((resolve) => {
    finishWarmup = resolve;
  });
  let warmupStarted = false;

  const result = await loadSessionForSwitch({
    sessionId: 'project-session',
    pool: {
      entries: new Map(),
      getSessionState: () => null,
    },
    ensureSession: async () => {
      warmupStarted = true;
      await warmup;
    },
    loadStoredSession: async () => ({
      id: 'project-session',
      projectDir: 'E:/projects/demo',
      model: 'test-model',
      lastSystemPrompt: 'Stored session system prompt',
      messages: [{ role: 'user', content: 'hello' }],
      compact: null,
    }),
    loadStoredUiMessages: () => [{ id: 'ui-1', role: 'you', text: 'hello' }],
    serializeMessages: (messages) => messages,
    normalizeProjectPath: (value) => value,
    isGeneralProjectDir: () => false,
  });

  assert.equal(warmupStarted, true);
  assert.deepEqual(result.sessionData.messages, [{ role: 'user', content: 'hello' }]);
  assert.deepEqual(result.sessionData.uiMessages, [{ id: 'ui-1', role: 'you', text: 'hello' }]);
  assert.equal(result.state.runtimePending, true);
  assert.equal(result.state.lastSystemPrompt, 'Stored session system prompt');

  finishWarmup();
});

test('warm session switch keeps using the live bridge state', async () => {
  const bridge = {
    getState: () => ({ sessionId: 'warm-session', busy: true }),
    getSessionMessages: () => [{ role: 'assistant', content: 'streaming' }],
    getSessionCompactMeta: () => ({ boundaryIndex: 2 }),
    getUiMessages: async () => [{ id: 'ui-live', role: 'assistant' }],
  };

  const result = await loadSessionForSwitch({
    sessionId: 'warm-session',
    pool: {
      entries: new Map([['warm-session', { bridge }]]),
      getSessionState: () => ({ projectDir: 'E:/projects/live' }),
    },
    ensureSession: async () => {
      throw new Error('warm sessions must not be recreated');
    },
    loadStoredSession: async () => {
      throw new Error('warm sessions must not reload storage');
    },
    loadStoredUiMessages: () => [],
    normalizeProjectPath: (value) => value,
    isGeneralProjectDir: () => false,
  });

  assert.equal(result.state.busy, true);
  assert.equal(result.state.runtimePending, false);
  assert.deepEqual(result.sessionData.uiMessages, [{ id: 'ui-live', role: 'assistant' }]);
});
