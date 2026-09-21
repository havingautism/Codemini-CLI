import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { RuntimeBridge } from '../codemini-web/lib/runtime-bridge.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';

function createWakeRuntime({ drainCalls, sink = {} } = {}) {
  const runtime = {
    getCurrentSessionId: () => 'crew-wake-session',
    getRuntimeState: () => ({ sessionId: 'crew-wake-session' }),
    getLastSystemPrompt: () => '',
    setRequestToolApproval() {},
    setRequestUserInput() {},
    setOnTitleUpdate() {},
    setOnTitleStatus() {},
    setCrewEventSink(handler) {
      sink.handler = handler;
    },
    setCrewWakeSubmit(handler) {
      runtime.submitWake = handler;
    },
    drainCrewPendingWakes: async () => {
      drainCalls.count += 1;
    },
    isTurnActive: () => false,
    submit: async () => ({ type: 'assistant', text: 'handled' }),
  };
  return runtime;
}

test('crew wake does not chain the next wake before the UI can drain a queued prompt', async () => {
  closeSqliteDatabasesForTests();
  const previousGlobalDir = process.env.CODEMINI_GLOBAL_DIR;
  const globalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-crew-wake-yield-'));
  process.env.CODEMINI_GLOBAL_DIR = globalDir;
  const drainCalls = { count: 0 };
  const sink = {};
  const events = [];
  const runtime = createWakeRuntime({ drainCalls, events, sink });
  const bridge = new RuntimeBridge(runtime, {
    sessionId: 'crew-wake-session',
    onEvent: (event) => events.push(event),
  });
  try {
    await runtime.submitWake('<notification type="crew.worker.completed" workerId="liam">done</notification>');
    assert.equal(drainCalls.count, 0);
    await bridge.drainCrewPendingWakes();
    assert.equal(drainCalls.count, 1);
  } finally {
    await bridge.dispose();
    closeSqliteDatabasesForTests();
    if (previousGlobalDir === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previousGlobalDir;
    await fs.rm(globalDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
});

test('queued crew wake paints a divider without starting a turn', async () => {
  closeSqliteDatabasesForTests();
  const previousGlobalDir = process.env.CODEMINI_GLOBAL_DIR;
  const globalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-crew-wake-divider-'));
  process.env.CODEMINI_GLOBAL_DIR = globalDir;
  const drainCalls = { count: 0 };
  const sink = {};
  const events = [];
  let submitCalls = 0;
  const runtime = createWakeRuntime({ drainCalls, sink });
  runtime.submit = async () => {
    submitCalls += 1;
    return { type: 'assistant', text: 'handled' };
  };
  const bridge = new RuntimeBridge(runtime, {
    sessionId: 'crew-wake-session',
    onEvent: (event) => events.push(event),
  });
  try {
    sink.handler({
      type: 'crew:wake',
      headline: 'Crew worker "liam" completed.',
      messageId: 'wake-early',
      timestamp: '2026-09-21T00:00:00.000Z',
      pending: true,
    });
    const pending = events.filter((event) => event.type === 'crew:wake');
    assert.equal(pending.length, 1);
    assert.equal(pending[0].pending, true);
    assert.equal(pending[0].messageId, 'wake-early');
    assert.equal(submitCalls, 0);

    await runtime.submitWake(
      '<notification type="crew.worker.completed" workerId="liam">done</notification>',
      { messageId: 'wake-early', timestamp: '2026-09-21T00:00:00.000Z' },
    );
    const wakeEvents = events.filter((event) => event.type === 'crew:wake');
    assert.equal(wakeEvents.length, 2);
    assert.equal(wakeEvents[1].pending, false);
    assert.equal(wakeEvents[1].messageId, 'wake-early');
    assert.equal(submitCalls, 1);
  } finally {
    await bridge.dispose();
    closeSqliteDatabasesForTests();
    if (previousGlobalDir === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previousGlobalDir;
    await fs.rm(globalDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
});

test('user submit does not auto-drain crew wakes', async () => {
  closeSqliteDatabasesForTests();
  const previousGlobalDir = process.env.CODEMINI_GLOBAL_DIR;
  const globalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-user-submit-no-wake-drain-'));
  process.env.CODEMINI_GLOBAL_DIR = globalDir;
  const drainCalls = { count: 0 };
  const sink = {};
  const runtime = createWakeRuntime({ drainCalls, sink });
  runtime.submitMessage = async () => ({ type: 'assistant', text: 'ok' });
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const bridge = new RuntimeBridge(runtime, {
    sessionId: 'crew-wake-session',
    onEvent: (event) => {
      if (event.type === 'submit:done') resolveDone();
    },
  });
  try {
    const accepted = bridge.handleSubmitMessage({ text: 'follow-up', messageId: 'u1' });
    assert.equal(accepted.accepted, true);
    await done;
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(drainCalls.count, 0);
  } finally {
    await bridge.dispose();
    closeSqliteDatabasesForTests();
    if (previousGlobalDir === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previousGlobalDir;
    await fs.rm(globalDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
});
