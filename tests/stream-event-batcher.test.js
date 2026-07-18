import test from 'node:test';
import assert from 'node:assert/strict';

import { createStreamEventBatcher } from '../codemini-web/client/src/lib/stream-event-batcher.js';

test('stream event batcher merges adjacent deltas within one frame', () => {
  const handled = [];
  let scheduled;
  const batcher = createStreamEventBatcher({
    handleEvent: (event) => handled.push(event),
    schedule: (callback) => { scheduled = callback; return 1; },
    cancel: () => {},
  });

  batcher.push({ type: 'assistant:delta', sessionId: 's', messageId: 'm', text: 'a' });
  batcher.push({ type: 'assistant:delta', sessionId: 's', messageId: 'm', text: 'b' });
  assert.deepEqual(handled, []);
  scheduled();

  assert.deepEqual(handled, [
    { type: 'assistant:delta', sessionId: 's', messageId: 'm', text: 'ab' },
  ]);
});

test('non-delta events flush buffered text before preserving event order', () => {
  const handled = [];
  const batcher = createStreamEventBatcher({
    handleEvent: (event) => handled.push(event.type),
    schedule: () => 1,
    cancel: () => {},
  });

  batcher.push({ type: 'assistant:delta', sessionId: 's', messageId: 'm', text: 'a' });
  batcher.push({ type: 'tool:start', sessionId: 's', id: 'tool' });
  assert.deepEqual(handled, ['assistant:delta', 'tool:start']);
});
