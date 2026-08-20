const BATCHABLE_STREAM_EVENTS = new Set([
  'assistant:delta',
  'assistant:reasoning_delta',
]);

export function createStreamEventBatcher({
  handleEvent,
  schedule = (callback) => requestAnimationFrame(callback),
  cancel = (id) => cancelAnimationFrame(id),
} = {}) {
  if (typeof handleEvent !== 'function') throw new TypeError('handleEvent must be a function');
  let queued = [];
  let scheduledId = null;

  // Materialize chunk-accumulated deltas into the single `text` property
  // consumers read, restoring the original event shape before delivery.
  const deliver = (events) => {
    for (const event of events) {
      if (Array.isArray(event.chunks)) {
        event.text = event.chunks.join('');
        delete event.chunks;
      }
      handleEvent(event);
    }
  };

  const flush = () => {
    if (scheduledId !== null) {
      cancel(scheduledId);
      scheduledId = null;
    }
    const events = queued;
    queued = [];
    deliver(events);
  };

  const scheduleFlush = () => {
    if (scheduledId !== null) return;
    scheduledId = schedule(() => {
      scheduledId = null;
      const events = queued;
      queued = [];
      deliver(events);
    });
  };

  return {
    push(event) {
      if (!BATCHABLE_STREAM_EVENTS.has(event?.type)) {
        flush();
        handleEvent(event);
        return;
      }
      const previous = queued.at(-1);
      if (
        previous?.type === event.type
        && previous.sessionId === event.sessionId
        && previous.messageId === event.messageId
      ) {
        // Accumulate chunks instead of concatenating the whole string per
        // delta (avoids O(n^2) full-string copies while streaming).
        previous.chunks.push(event.text || '');
      } else {
        queued.push({ ...event, chunks: [event.text || ''] });
      }
      scheduleFlush();
    },
    flush,
    dispose({ flush: shouldFlush = true } = {}) {
      if (shouldFlush) {
        flush();
        return;
      }
      if (scheduledId !== null) cancel(scheduledId);
      scheduledId = null;
      queued = [];
    },
  };
}
