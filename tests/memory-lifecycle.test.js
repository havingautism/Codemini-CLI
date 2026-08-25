import test from 'node:test';
import assert from 'node:assert/strict';
import { isMemoryStale, findStaleMemories, findLowUtilityMemories } from '../src/core/memory-lifecycle.js';

const NOW = Date.parse('2026-01-01T00:00:00Z');

test('expected_valid_days expiry flags a memory stale, but never pinned/archived', () => {
  const stale = isMemoryStale({
    expectedValidDays: 30,
    lifecycle: 'operational',
    pinned: false,
    updatedAt: '2025-10-01T00:00:00Z'
  }, NOW);
  assert.equal(stale, true);

  const fresh = isMemoryStale({
    expectedValidDays: 30,
    lifecycle: 'operational',
    pinned: false,
    updatedAt: '2025-12-20T00:00:00Z'
  }, NOW);
  assert.equal(fresh, false);

  const pinned = isMemoryStale({
    expectedValidDays: 30,
    lifecycle: 'operational',
    pinned: true,
    updatedAt: '2025-10-01T00:00:00Z'
  }, NOW);
  assert.equal(pinned, false);

  const noTtl = isMemoryStale({ expectedValidDays: undefined, updatedAt: '2025-10-01T00:00:00Z' }, NOW);
  assert.equal(noTtl, false);
});

test('findStaleMemories collects only expired, unprotected items', () => {
  const items = [
    { id: 'a', expectedValidDays: 30, lifecycle: 'operational', pinned: false, updatedAt: '2025-10-01T00:00:00Z' },
    { id: 'b', expectedValidDays: 30, lifecycle: 'operational', pinned: false, updatedAt: '2025-12-20T00:00:00Z' },
    { id: 'c', expectedValidDays: 30, lifecycle: 'archived', pinned: false, updatedAt: '2025-10-01T00:00:00Z' }
  ];
  const stale = findStaleMemories(items, NOW);
  assert.deepEqual(stale.map((i) => i.id), ['a']);
});

test('findLowUtilityMemories ranks by retention score and protects pinned', () => {
  const items = [
    { id: 'cold', lifecycle: 'operational', pinned: false, confidence: 0.5, accessCount: 0 },
    { id: 'hot', lifecycle: 'operational', pinned: false, confidence: 0.9, accessCount: 50, lastConfirmedAt: new Date().toISOString() },
    { id: 'pinned', lifecycle: 'operational', pinned: true, confidence: 0.1, accessCount: 0 }
  ];
  const low = findLowUtilityMemories(items, Date.now());
  assert.deepEqual(low.map((i) => i.id), ['cold']);
});
