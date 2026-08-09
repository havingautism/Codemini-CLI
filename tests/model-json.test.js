import test from 'node:test';
import assert from 'node:assert/strict';

import { parseModelJson, parseModelJsonObject } from '../src/core/model-json.js';

test('model JSON helper extracts fenced output and repairs common model mistakes', () => {
  assert.deepEqual(
    parseModelJson("result:\n```json\n{answer: 'yes', items: [1, 2,],}\n```"),
    { answer: 'yes', items: [1, 2] },
  );
  assert.deepEqual(parseModelJson('[1, 2, 3'), [1, 2, 3]);
  assert.equal(parseModelJsonObject('[1, 2]'), null);
});
