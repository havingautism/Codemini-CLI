import test from 'node:test';
import assert from 'node:assert/strict';
import { replayHarnessEpisode } from '../src/core/harness/audit/replay.js';

test('replay orders events by step and invokes the evaluator', async () => {
  const seen = [];
  const result = await replayHarnessEpisode({
    events: [{ step: 2, type: 'b' }, { step: 1, type: 'a' }],
    onEvent: (event) => seen.push(event.type),
  });
  assert.deepEqual(seen, ['a', 'b']);
  assert.equal(result.step, 2);
});
