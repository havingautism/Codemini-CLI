import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createToolResultStore } from '../src/core/tool-result-store.js';
import { getBuiltinTools } from '../src/core/tools.js';

test('tool result stores keep concurrent session outputs in their own directories', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-result-store-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sessionA = path.join(root, 'session-a');
  const sessionB = path.join(root, 'session-b');
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(workspace);
  const storeA = createToolResultStore({ resultDir: sessionA });
  const storeB = createToolResultStore({ resultDir: sessionB });
  const largeFormatted = 'preview'.repeat(1000);
  const rawA = `session-a:${'a'.repeat(7000)}`;
  const rawB = `session-b:${'b'.repeat(7000)}`;

  const [outputA, outputB] = await Promise.all([
    storeA.storeResultIfNeeded('call_same', largeFormatted, rawA),
    storeB.storeResultIfNeeded('call_same', largeFormatted, rawB),
  ]);

  const fileA = path.join(sessionA, 'tool-results', 'call_same.txt');
  const fileB = path.join(sessionB, 'tool-results', 'call_same.txt');
  assert.equal(outputA.includes(fileA), true);
  assert.equal(outputB.includes(fileB), true);
  assert.equal(await fs.readFile(fileA, 'utf8'), rawA);
  assert.equal(await fs.readFile(fileB, 'utf8'), rawB);

  const builtinTools = getBuiltinTools({
    workspaceRoot: workspace,
    sessionId: 'session-a',
    toolResultStore: storeA,
    config: {
      context: { read_file_default_lines: 120, read_file_max_chars: 12000 },
      execution: { approval_mode: 'review' },
      policy: { allowed_paths: [sessionA] },
      runtime: {},
    },
  });
  const readResult = await builtinTools.handlers.read({
    path: fileA,
    include_content: true,
    end_line: 1,
  });
  assert.equal(readResult.content, rawA);
  await builtinTools.dispose();
});

test('read deduplication is isolated per session store', () => {
  const storeA = createToolResultStore();
  const storeB = createToolResultStore();

  assert.equal(storeA.checkReadDedup('shared.txt', 1, 20, 123), false);
  assert.equal(storeB.checkReadDedup('shared.txt', 1, 20, 123), false);
  assert.equal(storeA.checkReadDedup('shared.txt', 1, 20, 123), true);
});
