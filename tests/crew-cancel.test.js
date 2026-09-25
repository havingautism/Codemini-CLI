import assert from 'node:assert/strict';
import test from 'node:test';

import { createCrewCancelReason, isCrewCancelSignal } from '../src/core/crew-cancel.js';

test('isCrewCancelSignal only matches Crew cancel aborts', () => {
  const crew = new AbortController();
  crew.abort(createCrewCancelReason());
  assert.equal(isCrewCancelSignal(crew.signal), true);

  const plain = new AbortController();
  plain.abort();
  assert.equal(isCrewCancelSignal(plain.signal), false);
  assert.equal(isCrewCancelSignal(undefined), false);
});
