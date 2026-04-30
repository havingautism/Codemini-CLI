import test from 'node:test';
import assert from 'node:assert/strict';

import { checkReadDedup, clearResultStore } from '../src/core/tool-result-store.js';

test('clearResultStore clears read deduplication state', async () => {
  assert.equal(checkReadDedup('src/core/tools.js', 1, 10, 123), false);
  assert.equal(checkReadDedup('src/core/tools.js', 1, 10, 123), true);

  await clearResultStore();

  assert.equal(checkReadDedup('src/core/tools.js', 1, 10, 123), false);
});
