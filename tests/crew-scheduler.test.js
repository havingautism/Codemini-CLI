import assert from 'node:assert/strict';
import test from 'node:test';

import { createCrewWorkerScheduler } from '../src/core/crew-scheduler.js';

test('crew scheduler caps active workers and starts queued work in order', async () => {
  const scheduler = createCrewWorkerScheduler({ getLimit: () => 2 });
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

test('crew scheduler drops aborted queued work without starting it', async () => {
  const scheduler = createCrewWorkerScheduler({ getLimit: () => 1 });
  const controller = new AbortController();
  let started = false;
  const first = scheduler.run(() => new Promise(() => {}));
  const queued = scheduler.run(
    () => {
      started = true;
      return Promise.resolve('ran');
    },
    { signal: controller.signal },
  );
  assert.deepEqual(scheduler.snapshot(), { active: 1, queued: 1, limit: 1 });
  controller.abort({ crewCancel: true });
  await assert.rejects(queued, (error) => error?.name === 'AbortError' || error?.crewCancel === true);
  assert.equal(started, false);
  assert.deepEqual(scheduler.snapshot(), { active: 1, queued: 0, limit: 1 });
  void first;
});
