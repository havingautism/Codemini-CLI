import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inferMemoryFamily,
  normalizeMemoryFamily
} from '../src/core/memory-policy.js';

test('normalizeMemoryFamily accepts the four families and infers otherwise', () => {
  assert.equal(normalizeMemoryFamily('personal'), 'personal');
  assert.equal(normalizeMemoryFamily('repo'), 'repo');
  assert.equal(normalizeMemoryFamily('coding'), 'coding');
  assert.equal(normalizeMemoryFamily('procedure'), 'procedure');
  assert.equal(normalizeMemoryFamily('nope', { fallback: 'repo' }), 'repo');
});

test('inferMemoryFamily maps preference/user to personal and lessons to coding', () => {
  assert.equal(inferMemoryFamily({ scope: 'user', kind: 'preference' }), 'personal');
  assert.equal(inferMemoryFamily({ scope: 'project', kind: 'lesson' }), 'coding');
  assert.equal(inferMemoryFamily({ scope: 'global', kind: 'lesson' }), 'coding');
});

test('inferMemoryFamily maps project conventions to repo unless they look like procedures', () => {
  assert.equal(inferMemoryFamily({
    scope: 'project',
    kind: 'convention',
    content: 'backend lives in packages/server'
  }), 'repo');
  assert.equal(inferMemoryFamily({
    scope: 'project',
    kind: 'convention',
    content: 'After changing the provider layer: 1. check OpenAI-compatible 2. run provider tests'
  }), 'procedure');
});

test('explicit family wins over inference', () => {
  assert.equal(inferMemoryFamily({
    family: 'procedure',
    scope: 'project',
    kind: 'note',
    content: 'backend lives in packages/server'
  }), 'procedure');
});
