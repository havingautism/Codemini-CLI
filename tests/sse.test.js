import test from 'node:test';
import assert from 'node:assert/strict';

import { iterateSseJsonEvents } from '../src/core/sse.js';

test('SSE parser handles chunk boundaries, CRLF, multiline data, and DONE', async () => {
  async function* chunks() {
    yield Buffer.from('event: delta\r\ndata: {"text":');
    yield Buffer.from('\r\ndata: "ok"}\r\n\r\ndata: [DONE]\n\n');
  }

  const events = [];
  for await (const event of iterateSseJsonEvents(chunks())) events.push(event);

  assert.deepEqual(events, [
    { event: 'delta', done: false, data: { text: 'ok' } },
    { event: 'message', done: true, data: null },
  ]);
});
