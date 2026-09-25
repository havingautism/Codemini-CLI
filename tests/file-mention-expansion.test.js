import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expandFileMentions } from '../src/core/chat-runtime.js';

test('file mentions expand quoted workspace paths with spaces', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-file-mention-'));
  try {
    await fs.mkdir(path.join(workspace, 'my folder'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'my folder', 'notes.txt'), 'one\ntwo\nthree');

    const expanded = await expandFileMentions(
      'inspect @"my folder/notes.txt":2-3 please',
      workspace,
    );
    assert.match(expanded, /\[FILE:my folder\/notes\.txt:2-3\]\ntwo\nthree\n\[\/FILE\]/);
    assert.match(expanded, /inspect[\s\S]*please/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('file mentions cannot escape through a sibling path prefix', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-file-boundary-'));
  const workspace = path.join(parent, 'workspace');
  const sibling = path.join(parent, 'workspace-secret');
  try {
    await fs.mkdir(workspace);
    await fs.mkdir(sibling);
    await fs.writeFile(path.join(sibling, 'secret.txt'), 'private');
    const original = '@../workspace-secret/secret.txt';
    assert.equal(await expandFileMentions(original, workspace), original);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});
