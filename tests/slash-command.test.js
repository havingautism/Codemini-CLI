import assert from 'node:assert/strict';
import test from 'node:test';

import { parseSlashCommandInvocation, renderCommandPrompt } from '../src/core/command-loader.js';
import { parseComposerSlashQuery } from '../codemini-web/client/src/lib/chat-composer-state.js';

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

test('command rendering appends arguments when the command has no placeholders', () => {
  const prompt = renderCommandPrompt({
    name: 'release',
    metadata: {},
    content: 'Prepare a release safely.',
  }, ['web']);
  assert.match(prompt, /Executing command: \/release/);
  assert.match(prompt, /\[User task\]\nweb/);
});
