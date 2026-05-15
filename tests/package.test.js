import test from 'node:test';
import assert from 'node:assert/strict';

import pkg from '../package.json' with { type: 'json' };

test('Playwright is optional and not installed as a default dependency', () => {
  assert.equal(pkg.dependencies?.playwright, undefined);
  assert.equal(pkg.optionalDependencies?.playwright, undefined);
});

test('npm package includes the built Web UI runtime', () => {
  assert.ok(pkg.files.includes('codemini-web/server.js'));
  assert.ok(pkg.files.includes('codemini-web/lib'));
  assert.ok(pkg.files.includes('codemini-web/dist'));
  assert.equal(pkg.scripts?.prepack, 'npm run build:web');
});
