import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicWriteUtf8 } from '../src/core/staged-write.js';
import { getBuiltinTools, markSandboxEscalationApproved } from '../src/core/tools.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';

async function fixture(t, platform = 'win32', mode = 'workspace-write', extra = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-write-contract-'));
  const bundle = getBuiltinTools({ workspaceRoot: root, platform, config: {
    sandbox: { enabled: true, mode, backend: platform === 'win32' ? 'microsandbox' : 'os' },
  }, ...extra });
  t.after(async () => {
    await bundle.dispose();
    closeSqliteDatabasesForTests();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });
  return { root, bundle };
}

const patch = (body) => `*** Begin Patch\n${body}\n*** End Patch`;

for (const platform of ['win32', 'linux', 'darwin']) {
  test(`${platform}: patch obeys read-only sandbox for add, update, delete and move`, async (t) => {
    const { root, bundle } = await fixture(t, platform, 'read-only');
    await fs.writeFile(path.join(root, 'existing.txt'), 'before\n');
    for (const body of [
      '*** Add File: new.txt\n+new',
      '*** Update File: existing.txt\n@@\n-before\n+after',
      '*** Delete File: existing.txt',
      '*** Update File: existing.txt\n*** Move to: moved.txt\n@@\n-before\n+after',
    ]) {
      await assert.rejects(bundle.handlers.apply_patch({ patch_text: patch(body) }), (error) => error.code === 'FS_SANDBOX_DENIED');
      assert.equal(await fs.readFile(path.join(root, 'existing.txt'), 'utf8'), 'before\n');
    }
    await assert.rejects(fs.stat(path.join(root, 'new.txt')), { code: 'ENOENT' });
    await assert.rejects(fs.stat(path.join(root, 'moved.txt')), { code: 'ENOENT' });
  });

  test(`${platform}: edit rejects missing replacements and no-ops, permits explicit deletion`, async (t) => {
    const { root, bundle } = await fixture(t, platform);
    await fs.writeFile(path.join(root, 'sample.txt'), 'before\n');
    await bundle.handlers.read({ path: 'sample.txt' });
    const args = { path: 'sample.txt', file_path: 'sample.txt', old_string: 'before' };
    await assert.rejects(bundle.handlers.edit({ ...args, new_string: 'before' }), /must differ/);
    await assert.rejects(bundle.handlers.edit({ ...args, kind: 'replace_text' }), /requires new_text|new_string/);
    assert.equal(await fs.readFile(path.join(root, 'sample.txt'), 'utf8'), 'before\n');
    await bundle.handlers.edit({ ...args, new_string: '' });
    assert.equal(await fs.readFile(path.join(root, 'sample.txt'), 'utf8'), '\n');
  });

  test(`${platform}: patch sandbox escalation requires the existing approval marker`, async (t) => {
    const { root, bundle } = await fixture(t, platform, 'read-only');
    const args = { patch_text: patch('*** Add File: approved.txt\n+approved'),
      sandbox_permissions: 'workspace-write', justification: 'Create the requested workspace file.' };
    await assert.rejects(bundle.handlers.apply_patch(args), /explicit user approval/);
    assert.equal((await bundle.handlers.apply_patch(markSandboxEscalationApproved(args))).ok, true);
    assert.equal(await fs.readFile(path.join(root, 'approved.txt'), 'utf8'), 'approved\n');
  });
}

test('patch EOF anchor selects only the final occurrence and respects CRLF', async (t) => {
  const { root, bundle } = await fixture(t);
  await fs.writeFile(path.join(root, 'sample.txt'), 'same\r\nseparator\r\nsame\r\n');
  const result = await bundle.handlers.apply_patch({ patch_text: patch('*** Update File: sample.txt\n@@\n-same\n+last\n*** End of File') });
  assert.equal(result.ok, true);
  assert.equal(await fs.readFile(path.join(root, 'sample.txt'), 'utf8'), 'same\r\nseparator\r\nlast\r\n');
  assert.match(bundle.formatters.apply_patch(result), /Patched 1 file/);
  assert.doesNotMatch(bundle.formatters.apply_patch(result), /diff_preview|separator/);
});

test('patch preflight rejects an occupied move destination before changing any file', async (t) => {
  const { root, bundle } = await fixture(t);
  await fs.writeFile(path.join(root, 'first.txt'), 'first\n');
  await fs.writeFile(path.join(root, 'source.txt'), 'source\n');
  await fs.writeFile(path.join(root, 'occupied.txt'), 'keep\n');
  await assert.rejects(bundle.handlers.apply_patch({ patch_text: patch('*** Update File: first.txt\n@@\n-first\n+changed\n*** Update File: source.txt\n*** Move to: occupied.txt\n@@\n-source\n+moved') }), /destination already exists/);
  assert.equal(await fs.readFile(path.join(root, 'first.txt'), 'utf8'), 'first\n');
  assert.equal(await fs.readFile(path.join(root, 'occupied.txt'), 'utf8'), 'keep\n');
  assert.equal(await fs.readFile(path.join(root, 'source.txt'), 'utf8'), 'source\n');
});

test('patch rejects duplicate target sections rather than losing an earlier edit', async (t) => {
  const { root, bundle } = await fixture(t);
  await fs.writeFile(path.join(root, 'sample.txt'), 'a\nb\n');
  await assert.rejects(bundle.handlers.apply_patch({ patch_text: patch('*** Update File: sample.txt\n@@\n-a\n+A\n*** Update File: sample.txt\n@@\n-b\n+B') }), /combine its hunks/);
  assert.equal(await fs.readFile(path.join(root, 'sample.txt'), 'utf8'), 'a\nb\n');
});

test('patch reports known partial effects when a later commit fails', async (t) => {
  let root;
  const made = await fixture(t, 'win32', 'workspace-write', { beforeApplyPatchMutation: async () => {
    await fs.writeFile(path.join(root, 'second.txt'), 'external creator\n');
  } });
  root = made.root;
  const result = await made.bundle.handlers.apply_patch({ patch_text: patch('*** Add File: first.txt\n+first\n*** Add File: second.txt\n+second') });
  assert.equal(result.ok, false);
  assert.equal(result.partial, true);
  assert.deepEqual(result.files, ['first.txt']);
  assert.equal(result.failed_path, 'second.txt');
  assert.match(result.error, /1 operation\(s\) published/);
  assert.equal(await fs.readFile(path.join(root, 'first.txt'), 'utf8'), 'first\n');
  assert.equal(await fs.readFile(path.join(root, 'second.txt'), 'utf8'), 'external creator\n');
  assert.match(made.bundle.formatters.apply_patch(result), /Patch stopped/);
});

test('atomic create has one winner and never overwrites an existing file', async (t) => {
  const { root } = await fixture(t);
  const target = path.join(root, 'new.txt');
  const results = await Promise.allSettled([
    atomicWriteUtf8(target, 'first', '', { createOnly: true }),
    atomicWriteUtf8(target, 'second', '', { createOnly: true }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const content = await fs.readFile(target, 'utf8');
  await assert.rejects(atomicWriteUtf8(target, 'lost', '', { createOnly: true }), { code: 'EEXIST' });
  assert.equal(await fs.readFile(target, 'utf8'), content);
});

test('atomic failure leaves a pre-existing staging file intact', async (t) => {
  const { root } = await fixture(t);
  const temporary = path.join(root, '.sample.txt.codemini-collision.tmp');
  await fs.writeFile(temporary, 'another writer');
  await assert.rejects(atomicWriteUtf8(path.join(root, 'sample.txt'), 'new', 'collision'), { code: 'EEXIST' });
  assert.equal(await fs.readFile(temporary, 'utf8'), 'another writer');
});

test('atomic replacement preserves POSIX executable permissions', { skip: process.platform === 'win32' }, async (t) => {
  const { root } = await fixture(t);
  const target = path.join(root, 'script.sh');
  await fs.writeFile(target, '#!/bin/sh\nexit 0\n', { mode: 0o750 });
  await atomicWriteUtf8(target, '#!/bin/sh\nexit 1\n');
  assert.equal((await fs.stat(target)).mode & 0o777, 0o750);
});

test('staged commits keep hashes and diffs in metadata, not model feedback', async (t) => {
  const { bundle } = await fixture(t);
  const begin = await bundle.handlers.begin_write({ path: 'large.txt' });
  await bundle.handlers.write_chunk({ write_id: begin.write_id, sequence: 0, content: 'payload'.repeat(100) });
  const result = await bundle.handlers.commit_write({ write_id: begin.write_id, path: 'large.txt', total_chunks: 1 });
  assert.equal(result.sha256.length, 64);
  assert.ok(result.diff_preview);
  assert.ok(bundle.formatters.commit_write(result).length < 80);
  assert.doesNotMatch(bundle.formatters.commit_write(result), /payload|sha256/);
});
