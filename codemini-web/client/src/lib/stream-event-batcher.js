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

  const flush = () => {
    if (scheduledId !== null) {
      cancel(scheduledId);
      scheduledId = null;
    }
    const events = queued;
    queued = [];
    for (const event of events) handleEvent(event);
  };

  const scheduleFlush = () => {
    if (scheduledId !== null) return;
    scheduledId = schedule(() => {
      scheduledId = null;
      const events = queued;
      queued = [];
      for (const event of events) handleEvent(event);
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
        previous.text = `${previous.text || ''}${event.text || ''}`;
      } else {
        queued.push({ ...event });
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
