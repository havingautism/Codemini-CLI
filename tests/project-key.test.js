import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProjectDirKey } from '../codemini-web/shared/project-key.js';

test('normalizeProjectDirKey unifies windows path variants', () => {
  assert.equal(
    normalizeProjectDirKey('E:\\Git Projects\\随手记'),
    normalizeProjectDirKey('e:/Git Projects/随手记'),
  );
  assert.equal(
    normalizeProjectDirKey('E:\\Git Projects\\随手记\\'),
    normalizeProjectDirKey('e:/Git Projects/随手记'),
  );
});

test('normalizeProjectDirKey lowercases drive letter', () => {
  assert.equal(normalizeProjectDirKey('D:/foo'), 'd:/foo');
});
