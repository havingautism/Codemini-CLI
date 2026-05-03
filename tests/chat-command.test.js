import test from 'node:test';
import assert from 'node:assert/strict';

import { submitAndPrint } from '../src/commands/chat.js';

function createWriter() {
  const chunks = [];
  return {
    chunks,
    write(chunk) {
      chunks.push(String(chunk));
      return true;
    }
  };
}

test('submitAndPrint writes assistant deltas as they arrive for one-shot chat prompts', async () => {
  const writer = createWriter();
  const calls = [];
  const runtime = {
    async submit(line, onEvent) {
      calls.push(line);
      onEvent({ type: 'assistant:delta', text: 'hello ' });
      onEvent({ type: 'assistant:delta', text: 'world' });
      return { type: 'assistant', text: 'hello world' };
    }
  };

  const result = await submitAndPrint(runtime, 'stream please', { output: writer });

  assert.equal(result.type, 'assistant');
  assert.deepEqual(calls, ['stream please']);
  assert.deepEqual(writer.chunks, ['hello ', 'world', '\n']);
});

test('submitAndPrint prints final text when no assistant deltas were emitted', async () => {
  const writer = createWriter();
  const runtime = {
    async submit() {
      return { type: 'system', text: 'mode=auto' };
    }
  };

  await submitAndPrint(runtime, '/status', { output: writer });

  assert.deepEqual(writer.chunks, ['mode=auto\n']);
});
