import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { getBuiltinTools } from '../src/core/tools.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';

async function withTools(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-staged-write-'));
  const tools = getBuiltinTools({
    workspaceRoot: root,
    sessionId: 'staged-write-test',
    config: {
      context: { read_file_default_lines: 120, read_file_max_chars: 12000 },
      execution: { approval_mode: 'full_access' },
      runtime: {},
      tools: { write_chunk_max_chars: 32, staged_write_max_chars: 256 },
    },
  });
  t.after(async () => {
    await tools.dispose();
    closeSqliteDatabasesForTests();
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, tools };
}

test('staged write keeps the target untouched until atomic commit', async (t) => {
  const { root, tools } = await withTools(t);
  const target = path.join(root, 'src', 'message.txt');

  const begun = await tools.handlers.begin_write({ path: 'src/message.txt' });
  assert.equal(begun.next_sequence, 0);
  await assert.rejects(fs.stat(target), { code: 'ENOENT' });

  const first = await tools.handlers.write_chunk({
    write_id: begun.write_id,
    sequence: 0,
    content: 'hello ',
  });
  assert.equal(first.next_sequence, 1);
  const duplicate = await tools.handlers.write_chunk({
    write_id: begun.write_id,
    sequence: 0,
    content: 'hello ',
  });
  assert.equal(duplicate.duplicate, true);
  await tools.handlers.write_chunk({
    write_id: begun.write_id,
    sequence: 1,
    content: '世界',
  });
  await assert.rejects(fs.stat(target), { code: 'ENOENT' });

  const assembled = 'hello 世界';
  const expectedSha256 = createHash('sha256').update(assembled, 'utf8').digest('hex');
  const committed = await tools.handlers.commit_write({
    write_id: begun.write_id,
    path: 'src/message.txt',
    total_chunks: 2,
    expected_sha256: expectedSha256,
  });

  assert.equal(await fs.readFile(target, 'utf8'), assembled);
  assert.equal(committed.atomic, true);
  assert.equal(committed.sha256, expectedSha256);
  assert.equal(committed.action, 'create');
  await assert.rejects(
    tools.handlers.commit_write({
      write_id: begun.write_id,
      path: 'src/message.txt',
      total_chunks: 2,
    }),
    /Unknown or completed staged write/,
  );
});

test('begin_write can stage an outside target without touching it', async (t) => {
  const { root, tools } = await withTools(t);
  const target = path.join(path.dirname(root), `${path.basename(root)}-outside.txt`);
  t.after(() => fs.rm(target, { force: true }));

  const begun = await tools.handlers.begin_write({ path: target });
  assert.equal(path.normalize(begun.path), path.normalize(target));
  await assert.rejects(fs.stat(target), { code: 'ENOENT' });
  await tools.handlers.abort_write({ write_id: begun.write_id });
});

test('staged write enforces contiguous idempotent chunks and bounded payloads', async (t) => {
  const { tools } = await withTools(t);
  const begun = await tools.handlers.begin_write({ path: 'bounded.txt' });

  await assert.rejects(
    tools.handlers.write_chunk({
      write_id: begun.write_id,
      sequence: 1,
      content: 'late',
    }),
    /expected sequence 0, received 1/,
  );
  await assert.rejects(
    tools.handlers.write_chunk({
      write_id: begun.write_id,
      sequence: 0,
      content: 'x'.repeat(33),
    }),
    /too large/,
  );
  await tools.handlers.write_chunk({
    write_id: begun.write_id,
    sequence: 0,
    content: 'first',
  });
  await assert.rejects(
    tools.handlers.write_chunk({
      write_id: begun.write_id,
      sequence: 0,
      content: 'different',
    }),
    /already stored with different content/,
  );

  const aborted = await tools.handlers.abort_write({ write_id: begun.write_id });
  assert.equal(aborted.aborted, true);
  assert.equal(aborted.discarded_chunks, 1);
});

test('commit rejects hash, path, and file-version mismatches without overwriting', async (t) => {
  const { root, tools } = await withTools(t);
  const target = path.join(root, 'existing.txt');
  await fs.writeFile(target, 'original', 'utf8');
  const begun = await tools.handlers.begin_write({
    path: 'existing.txt',
    overwrite: true,
  });
  await tools.handlers.write_chunk({
    write_id: begun.write_id,
    sequence: 0,
    content: 'replacement',
  });

  await assert.rejects(
    tools.handlers.commit_write({
      write_id: begun.write_id,
      path: 'other.txt',
      total_chunks: 1,
    }),
    /path mismatch/,
  );
  await assert.rejects(
    tools.handlers.commit_write({
      write_id: begun.write_id,
      path: 'existing.txt',
      total_chunks: 1,
      expected_sha256: '0'.repeat(64),
    }),
    /sha256 mismatch/,
  );
  assert.equal(await fs.readFile(target, 'utf8'), 'original');

  await fs.writeFile(target, 'external change', 'utf8');
  await assert.rejects(
    tools.handlers.commit_write({
      write_id: begun.write_id,
      path: 'existing.txt',
      total_chunks: 1,
    }),
    (error) => error?.code === 'FILE_CONFLICT',
  );
  assert.equal(await fs.readFile(target, 'utf8'), 'external change');
});

test('staged write atomically replaces an existing file when overwrite is explicit', async (t) => {
  const { root, tools } = await withTools(t);
  const target = path.join(root, 'replace.txt');
  await fs.writeFile(target, 'before', 'utf8');
  const begun = await tools.handlers.begin_write({
    path: 'replace.txt',
    overwrite: true,
  });
  await tools.handlers.write_chunk({
    write_id: begun.write_id,
    sequence: 0,
    content: 'after',
  });

  const committed = await tools.handlers.commit_write({
    write_id: begun.write_id,
    path: 'replace.txt',
    total_chunks: 1,
  });

  assert.equal(await fs.readFile(target, 'utf8'), 'after');
  assert.equal(committed.action, 'rewrite_file');
  assert.equal(committed.overwritten, true);
});

test('staged write schemas keep large content as the final property', async (t) => {
  const { tools } = await withTools(t);
  const definitions = new Map(
    tools.definitions.map((definition) => [definition.function?.name, definition.function]),
  );

  assert.equal(Object.keys(definitions.get('write').parameters.properties).at(-1), 'content');
  assert.equal(Object.keys(definitions.get('write_chunk').parameters.properties).at(-1), 'content');
  assert.equal(Object.keys(definitions.get('edit').parameters.properties).at(-1), 'new_content');
  assert.deepEqual(definitions.get('edit').parameters.required, ['path']);
  assert.equal(Object.keys(definitions.get('Bash').parameters.properties).at(-1), 'command');
});
