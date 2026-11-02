import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseSlashCommandInvocation, renderCommandPrompt } from '../src/core/command-loader.js';
import {
  findComposerMentionToken,
  formatComposerFileMention,
  parseComposerMentionQuery,
  parseComposerSlashQuery,
  removeComposerMentionToken,
  replaceComposerMentionToken,
} from '../codemini-web/client/src/lib/chat-composer-state.js';
import { searchWorkspaceFiles } from '../codemini-web/lib/workspace-files.js';

test('slash command parser keeps an argument line and supports quoted arguments', () => {
  assert.deepEqual(parseSlashCommandInvocation('/release "dry run" web'), {
    name: 'release',
    argLine: '"dry run" web',
    args: ['dry run', 'web'],
  });
  assert.equal(parseSlashCommandInvocation('release now'), null);
});

test('web composer opens slash search only while typing the command token', () => {
  assert.equal(parseComposerSlashQuery('/'), '');
  assert.equal(parseComposerSlashQuery('/review'), 'review');
  assert.equal(parseComposerSlashQuery('/review this'), null);
  assert.equal(parseComposerSlashQuery('hello'), null);
});

test('web composer opens mention search only for a trailing @ token', () => {
  assert.equal(parseComposerMentionQuery('@'), '');
  assert.equal(parseComposerMentionQuery('look at @src/ap'), 'src/ap');
  assert.equal(parseComposerMentionQuery('@src/core/chat-runtime.js:1-20'), 'src/core/chat-runtime.js:1-20');
  assert.equal(parseComposerMentionQuery('hello'), null);
  assert.equal(parseComposerMentionQuery('user@example.com'), null);
  assert.equal(parseComposerMentionQuery('mid @token tail'), null);
  assert.equal(parseComposerMentionQuery('before @src/app after', 15), 'src/app');
  assert.equal(parseComposerMentionQuery('look at @"my fi'), 'my fi');
});

test('mention selection replaces only the trailing @ token', () => {
  assert.equal(
    replaceComposerMentionToken('hello @sr', '@src/app.js '),
    'hello @src/app.js ',
  );
  assert.equal(
    replaceComposerMentionToken('@re', '@README.md '),
    '@README.md ',
  );
  assert.equal(
    replaceComposerMentionToken('before @sr after', '@src/app.js ', 10),
    'before @src/app.js after',
  );
  assert.deepEqual(findComposerMentionToken('before @sr after', 10), {
    start: 7,
    end: 10,
    query: 'sr',
    quoted: false,
  });
  assert.equal(
    replaceComposerMentionToken('before @src/ap.js after', '@src/app.js ', 14),
    'before @src/app.js after',
  );
  assert.equal(formatComposerFileMention('my folder/a.js'), '@"my folder/a.js"');
  assert.equal(formatComposerFileMention('文档/说明.md'), '@"文档/说明.md"');
});

test('selected file mentions collapse out of composer text without damaging spacing', () => {
  assert.deepEqual(removeComposerMentionToken('before @src/ap after', 14), {
    text: 'before after',
    cursor: 7,
  });
  assert.deepEqual(removeComposerMentionToken('@README.md ', 10), {
    text: '',
    cursor: 0,
  });
  assert.deepEqual(removeComposerMentionToken('inspect @"my folder/a.js"', 16), {
    text: 'inspect ',
    cursor: 8,
  });
});

test('searchWorkspaceFiles ranks name matches and skips ignore dirs', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-mention-'));
  try {
    await fs.mkdir(path.join(workspace, 'src', 'nested'), { recursive: true });
    await fs.mkdir(path.join(workspace, 'node_modules', 'pkg'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'src', 'app.js'), 'x');
    await fs.writeFile(path.join(workspace, 'src', 'nested', 'app-utils.js'), 'x');
    await fs.writeFile(path.join(workspace, 'README.md'), 'x');
    await fs.writeFile(path.join(workspace, 'node_modules', 'pkg', 'app.js'), 'x');

    const result = await searchWorkspaceFiles(workspace, 'app');
    const found = result.files.map((file) => file.path);
    assert.ok(!found.some((file) => file.includes('node_modules')));
    assert.deepEqual(found[0], 'src/app.js');
    assert.ok(found.includes('src/nested/app-utils.js'));

    const fuzzy = await searchWorkspaceFiles(workspace, 'apu');
    assert.equal(fuzzy.files[0].path, 'src/nested/app-utils.js');

    const emptyQuery = await searchWorkspaceFiles(workspace, '');
    assert.deepEqual(
      emptyQuery.files.map((file) => file.path),
      ['README.md', 'src/app.js', 'src/nested/app-utils.js'],
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('command rendering appends arguments when the command has no placeholders', () => {
  const prompt = renderCommandPrompt({
    name: 'release',
    metadata: {},
    content: 'Prepare a release safely.',
  }, ['web']);
  assert.match(prompt, /Executing command: \/release/);
  assert.match(prompt, /\[User task\]\nweb/);
});
