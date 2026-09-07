import assert from 'node:assert/strict';
import test from 'node:test';

import { createTowerCancelReason, isTowerCancelSignal } from '../src/core/tower-cancel.js';

test('isTowerCancelSignal only matches Crew cancel aborts', () => {
  const crew = new AbortController();
  crew.abort(createTowerCancelReason());
  assert.equal(isTowerCancelSignal(crew.signal), true);

  const plain = new AbortController();
  plain.abort();
  assert.equal(isTowerCancelSignal(plain.signal), false);
  assert.equal(isTowerCancelSignal(undefined), false);
});
