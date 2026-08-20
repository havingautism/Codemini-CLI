import { createParser } from 'eventsource-parser';

export async function* iterateSseJsonEvents(stream) {
  const decoder = new TextDecoder();
  const pending = [];
  const parser = createParser({ onEvent: (event) => pending.push(event) });

  const drain = function* () {
    while (pending.length > 0) {
      const event = pending.shift();
      if (event.data === '[DONE]') {
        yield { event: event.event || 'message', done: true, data: null };
        continue;
      }
      let data = null;
      let parseError = false;
      try {
        data = JSON.parse(event.data);
      } catch {
        // keep-alive / ping / malformed payloads must not abort the whole
        // completion stream; surface them as parse errors instead.
        parseError = true;
      }
      yield parseError
        ? {
            event: event.event || 'message',
            done: false,
            data: null,
            parse_error: true,
            raw: event.data,
          }
        : { event: event.event || 'message', done: false, data };
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
