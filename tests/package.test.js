import test from 'node:test';
import assert from 'node:assert/strict';

import pkg from '../package.json' with { type: 'json' };

test('Playwright is optional and not installed as a default dependency', () => {
  assert.equal(pkg.dependencies?.playwright, undefined);
  assert.equal(pkg.optionalDependencies?.playwright, undefined);
});
