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
