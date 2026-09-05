import assert from 'node:assert/strict';
import test from 'node:test';

import { createTowerWorkerScheduler } from '../src/core/tower-scheduler.js';

test('tower scheduler caps active workers and starts queued work in order', async () => {
  const scheduler = createTowerWorkerScheduler({ getLimit: () => 2 });
  const releases = [];
  const events = [];
  const task = (id) => scheduler.run(
    () => new Promise((resolve) => releases.push(() => {
      events.push(`done:${id}`);
      resolve(id);
    })),
    {
      onQueued: () => events.push(`queued:${id}`),
      onStart: () => events.push(`start:${id}`),
    },
  );

  const results = [task('a'), task('b'), task('c')];
  assert.deepEqual(scheduler.snapshot(), { active: 2, queued: 1, limit: 2 });
  assert.deepEqual(events, ['start:a', 'start:b', 'queued:c']);
  await new Promise((resolve) => setImmediate(resolve));
  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(events.join(','), /start:c/);
  while (releases.length) releases.shift()();
  assert.deepEqual(await Promise.all(results), ['a', 'b', 'c']);
  assert.deepEqual(scheduler.snapshot(), { active: 0, queued: 0, limit: 2 });
});
