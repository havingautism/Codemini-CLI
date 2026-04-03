import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BoundedCache } from '../src/core/bounded-cache.js';

test('BoundedCache stores and retrieves values', () => {
  const cache = new BoundedCache();
  cache.set('a', 1);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.has('a'), true);
  assert.equal(cache.get('missing'), undefined);
  assert.equal(cache.has('missing'), false);
});

test('BoundedCache evicts oldest entries when maxSize is exceeded', () => {
  const cache = new BoundedCache({ maxSize: 3, ttlMs: 60_000 });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  assert.equal(cache.size, 3);
  cache.set('d', 4);
  assert.equal(cache.size, 3);
  assert.equal(cache.has('a'), false, 'oldest entry should be evicted');
  assert.equal(cache.has('d'), true, 'newest entry should be present');
});

test('BoundedCache expires entries based on TTL', () => {
  const cache = new BoundedCache({ maxSize: 10, ttlMs: 5 });
  cache.set('key', 'value');
  assert.equal(cache.get('key'), 'value');
  return new Promise((resolve) => {
    setTimeout(() => {
      assert.equal(cache.get('key'), undefined, 'expired entry should return undefined');
      assert.equal(cache.has('key'), false, 'expired entry should not be present');
      resolve();
    }, 20);
  });
});

test('BoundedCache clear removes all entries', () => {
  const cache = new BoundedCache();
  cache.set('a', 1);
  cache.set('b', 2);
  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.has('a'), false);
});

test('BoundedCache delete removes specific entry', () => {
  const cache = new BoundedCache();
  cache.set('a', 1);
  cache.set('b', 2);
  cache.delete('a');
  assert.equal(cache.has('a'), false);
  assert.equal(cache.has('b'), true);
});

test('BoundedCache values returns all live entries', () => {
  const cache = new BoundedCache({ ttlMs: 60_000 });
  cache.set('a', 1);
  cache.set('b', 2);
  const vals = cache.values();
  assert.deepEqual(vals.sort(), [1, 2]);
});

test('BoundedCache entries returns key-value pairs', () => {
  const cache = new BoundedCache({ ttlMs: 60_000 });
  cache.set('x', 10);
  const entries = cache.entries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0][0], 'x');
  assert.equal(entries[0][1], 10);
});

test('BoundedCache size prunes expired entries before returning', () => {
  const cache = new BoundedCache({ maxSize: 10, ttlMs: 5 });
  cache.set('a', 1);
  cache.set('b', 2);
  assert.equal(cache.size, 2);
  return new Promise((resolve) => {
    setTimeout(() => {
      assert.equal(cache.size, 0, 'size should prune and report 0 after TTL');
      resolve();
    }, 20);
  });
});

test('BoundedCache values prunes expired entries', () => {
  const cache = new BoundedCache({ maxSize: 10, ttlMs: 5 });
  cache.set('a', 1);
  return new Promise((resolve) => {
    setTimeout(() => {
      assert.deepEqual(cache.values(), [], 'values should not include expired');
      resolve();
    }, 20);
  });
});

test('BoundedCache onEvict is called when entry is evicted by size', () => {
  const evicted = [];
  const cache = new BoundedCache({ maxSize: 2, ttlMs: 60_000, onEvict(key, value) { evicted.push({ key, value }); } });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  assert.equal(evicted.length, 1);
  assert.equal(evicted[0].key, 'a');
  assert.equal(evicted[0].value, 1);
});

test('BoundedCache onEvict is called when entry expires on access', () => {
  const evicted = [];
  const cache = new BoundedCache({ maxSize: 10, ttlMs: 5, onEvict(key, value) { evicted.push({ key, value }); } });
  cache.set('a', 1);
  return new Promise((resolve) => {
    setTimeout(() => {
      cache.get('a');
      assert.equal(evicted.length, 1);
      assert.equal(evicted[0].key, 'a');
      resolve();
    }, 20);
  });
});

test('BoundedCache onEvict is called on clear', () => {
  const evicted = [];
  const cache = new BoundedCache({ maxSize: 10, ttlMs: 60_000, onEvict(key, value) { evicted.push({ key, value }); } });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.clear();
  assert.equal(evicted.length, 2);
});

test('BoundedCache onEvict deletes temp file on eviction', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-cache-test-'));
  const filePath = path.join(dir, 'test-result.txt');
  await fs.writeFile(filePath, 'hello', 'utf8');
  const cache = new BoundedCache({
    maxSize: 1,
    ttlMs: 60_000,
    onEvict(key, value) {
      if (value?.filePath) fs.unlink(value.filePath).catch(() => {});
    }
  });
  cache.set('a', { filePath });
  cache.set('b', { filePath: null });
  // 'a' was evicted, file should be deleted
  let exists = false;
  try { await fs.access(filePath); exists = true; } catch {}
  assert.equal(exists, false, 'evicted entry should trigger file cleanup');
  await fs.rm(dir, { recursive: true, force: true });
});
