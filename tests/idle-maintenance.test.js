import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdleMaintenanceScheduler } from '../src/core/idle-maintenance.js';

function setup(run) {
  const timers = new Map();
  let id = 0;
  const scheduler = createIdleMaintenanceScheduler(run, {
    setTimer: (callback) => { timers.set(++id, callback); return id; },
    clearTimer: (key) => timers.delete(key),
  });
  const fire = async () => {
    const current = [...timers.values()];
    timers.clear();
    current.forEach((callback) => callback());
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  return { scheduler, fire };
}

test('short turns coalesce and active work postpones maintenance', async () => {
  const calls = [];
  const { scheduler, fire } = setup(async (id, payload) => calls.push(payload));
  scheduler.schedule('s', 'old', 30000);
  const end = scheduler.begin('s');
  await fire();
  assert.deepEqual(calls, []);
  scheduler.schedule('s', 'latest', 30000);
  await fire();
  assert.deepEqual(calls, []);
  end();
  await fire();
  assert.deepEqual(calls, ['latest']);
});

test('new input invalidates maintenance already waiting behind another session', async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const { scheduler, fire } = setup(async (id) => {
    calls.push(id);
    if (id === 'first') await blocked;
  });
  scheduler.schedule('first', {}, 30000);
  scheduler.schedule('second', {}, 30000);
  await fire();
  const end = scheduler.begin('second');
  end();
  release();
  await fire();
  assert.deepEqual(calls, ['first']);
  scheduler.schedule('second', {}, 30000);
  await fire();
  assert.deepEqual(calls, ['first', 'second']);
});

test('nested activity and failed maintenance do not corrupt scheduling', async () => {
  const calls = [];
  const { scheduler, fire } = setup(async (id) => { calls.push(id); throw new Error('offline'); });
  const outer = scheduler.begin('s');
  const inner = scheduler.begin('s');
  outer();
  outer();
  assert.equal(scheduler.isActive('s'), true);
  scheduler.schedule('s', {}, 30000);
  inner();
  await fire();
  scheduler.schedule('next', {}, 30000);
  await fire();
  assert.deepEqual(calls, ['s', 'next']);
});
