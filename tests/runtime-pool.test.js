import test from 'node:test';
import assert from 'node:assert/strict';

import { RuntimePool } from '../codemini-web/lib/runtime-pool.js';

test('reloading config synchronizes the model across loaded sessions', async () => {
  const reloads = [];
  const broadcasts = [];
  const events = [];
  const pool = new RuntimePool({
    runtimeFactory: async ({ sessionId }) => ({
      async reloadConfig(options) {
        reloads.push({ sessionId, options });
      },
      broadcastRuntimeState() {
        broadcasts.push(sessionId);
      },
    }),
    onEvent: (event) => events.push(event),
  });

  await pool.ensureSession({
    sessionId: 'session-a',
    projectDir: 'C:\\project-a',
    model: 'old-model',
  });
  await pool.ensureSession({
    sessionId: 'session-b',
    projectDir: 'C:\\project-b',
    model: 'old-model',
  });

  await pool.reloadConfig({ model: 'new-model' });

  assert.deepEqual(reloads, [
    { sessionId: 'session-a', options: { model: 'new-model' } },
    { sessionId: 'session-b', options: { model: 'new-model' } },
  ]);
  assert.deepEqual(broadcasts, ['session-a', 'session-b']);
  assert.equal(pool.getSessionState('session-a').model, 'new-model');
  assert.equal(pool.getSessionState('session-b').model, 'new-model');
  assert.deepEqual(
    events.filter((event) => event.type === 'runtime_pool_state').map((event) => event.sessionId),
    ['session-a', 'session-b'],
  );
});

test('rekeySession moves a live pool entry to the continuation id', async () => {
  const events = [];
  const pool = new RuntimePool({
    runtimeFactory: async ({ sessionId }) => ({
      sessionId,
      abort: async () => true,
    }),
    onEvent: (event) => events.push(event),
    maxConcurrent: 1,
  });

  await pool.ensureSession({
    sessionId: 'session-old',
    projectDir: '/tmp/project',
    model: 'model',
  });
  let releaseRun;
  const runDone = new Promise((resolve) => {
    releaseRun = resolve;
  });
  const accepted = pool.submit('session-old', () => runDone);
  assert.equal(accepted.state, 'running');
  assert.equal(pool.getSessionState('session-old').sessionId, 'session-old');

  assert.equal(pool.rekeySession('session-old', 'session-new'), true);
  assert.equal(pool.getSessionState('session-old'), null);
  assert.equal(pool.getSessionState('session-new').sessionId, 'session-new');
  assert.equal(pool.getSessionState('session-new').status, 'running');
  assert.equal(pool.rekeySession('session-old', 'session-new'), false);
  assert.equal(pool.rekeySession('session-new', 'session-new'), false);

  await pool.ensureSession({
    sessionId: 'session-queued',
    projectDir: '/tmp/project',
    model: 'model',
  });
  let releaseQueued;
  const queuedDone = new Promise((resolve) => {
    releaseQueued = resolve;
  });
  const queuedSubmit = pool.submit('session-queued', () => queuedDone);
  assert.equal(queuedSubmit.state, 'queued');
  assert.equal(pool.rekeySession('session-queued', 'session-queued-next'), true);
  assert.equal(pool.getSessionState('session-queued'), null);
  assert.equal(pool.getSessionState('session-queued-next').status, 'queued');

  releaseRun({ status: 'aborted' });
  releaseQueued({ status: 'completed' });
  await pool.abort('session-new');
  await pool.abort('session-queued-next');
});
