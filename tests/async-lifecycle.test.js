import test from 'node:test';
import assert from 'node:assert/strict';

import { finishInitialization } from '../codemini-web/client/src/lib/async-lifecycle.js';

test('finishInitialization connects before non-critical hydration finishes', async () => {
  const events = [];
  let release;
  const slowTask = new Promise((resolve) => { release = resolve; });

  const finishing = finishInitialization({
    tasks: [slowTask],
    isAlive: () => true,
    update: (patch) => events.push(['update', patch]),
    connect: () => events.push(['connect']),
  });

  await Promise.resolve();
  assert.deepEqual(events, [['connect']]);
  release();
  await finishing;
  assert.deepEqual(events, [
    ['connect'],
    ['update', { initialLoading: false }],
  ]);
});

test('finishInitialization settles optional hydration failures', async () => {
  const events = [];
  const result = await finishInitialization({
    tasks: [Promise.reject(new Error('optional load failed'))],
    isAlive: () => true,
    update: (patch) => events.push(['update', patch]),
    connect: () => events.push(['connect']),
  });

  assert.equal(result, true);
  assert.deepEqual(events.at(-1), ['update', { initialLoading: false }]);
});
