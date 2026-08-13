import { createParser } from 'eventsource-parser';

export async function* iterateSseJsonEvents(stream) {
  const decoder = new TextDecoder();
  const pending = [];
  const parser = createParser({ onEvent: (event) => pending.push(event) });

  const drain = function* () {
    while (pending.length > 0) {
      const event = pending.shift();
      yield event.data === '[DONE]'
        ? { event: event.event || 'message', done: true, data: null }
        : { event: event.event || 'message', done: false, data: JSON.parse(event.data) };
    }
  };

  for await (const chunk of stream) {
    parser.feed(decoder.decode(chunk, { stream: true }));
    yield* drain();
  }
  parser.feed(decoder.decode());
  parser.feed('\n\n');
  yield* drain();
}
