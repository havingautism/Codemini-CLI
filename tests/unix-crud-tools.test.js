import test from 'node:test';
import assert from 'node:assert/strict';
import { getBuiltinTools } from '../src/core/tools.js';

function names(definitions = []) {
  return definitions.map((d) => d?.function?.name || d?.name).filter(Boolean);
}

test('Windows keeps staged write and apply_patch always-on; grep/glob deferred', () => {
  const bundle = getBuiltinTools({
    workspaceRoot: process.cwd(),
    config: {},
    platform: 'win32',
  });
  const active = new Set(names(bundle.definitions));
  const deferred = new Set(Object.keys(bundle.deferredDefinitions || {}));
  for (const name of ['begin_write', 'write_chunk', 'commit_write', 'abort_write', 'apply_patch']) {
    assert.ok(active.has(name), `${name} should be active on win32`);
    assert.ok(!deferred.has(name), `${name} should not be deferred on win32`);
  }
  assert.ok(deferred.has('grep'));
  assert.ok(deferred.has('glob'));
  assert.ok(!active.has('grep'));
  assert.ok(!active.has('glob'));
});

test('Linux promotes grep/glob and drops staged write + apply_patch', () => {
  const bundle = getBuiltinTools({
    workspaceRoot: process.cwd(),
    config: {},
    platform: 'linux',
  });
  const active = new Set(names(bundle.definitions));
  const deferred = new Set(Object.keys(bundle.deferredDefinitions || {}));
  assert.ok(active.has('grep'));
  assert.ok(active.has('glob'));
  assert.ok(active.has('edit'));
  assert.ok(active.has('write'));
  assert.ok(active.has('read'));
  assert.ok(active.has('delete'));
  assert.ok(active.has('search_code'));
  for (const name of ['begin_write', 'write_chunk', 'commit_write', 'abort_write', 'apply_patch']) {
    assert.ok(!active.has(name), `${name} should not be active on linux`);
    assert.ok(!deferred.has(name), `${name} should not be deferred on linux`);
  }
  const edit = bundle.definitions.find((d) => d?.function?.name === 'edit');
  assert.ok(edit?.function?.parameters?.properties?.old_string);
  assert.ok(edit?.function?.parameters?.properties?.new_string);
  const run = bundle.definitions.find((d) => d?.function?.name === 'run');
  assert.ok(run?.function?.parameters?.properties?.sandbox_permissions);
});

test('edit handler accepts old_string/new_string aliases', async () => {
  const bundle = getBuiltinTools({
    workspaceRoot: process.cwd(),
    config: {
      policy: { allowed_paths: [] },
      sandbox: { enabled: false, mode: 'danger-full-access' },
    },
    platform: 'linux',
  });
  // Just ensure the schema + handler wiring exists; full edit I/O covered elsewhere.
  assert.equal(typeof bundle.handlers.edit, 'function');
  assert.ok(bundle.definitions.some((d) => d?.function?.name === 'edit'));
});
