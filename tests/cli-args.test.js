import test from 'node:test';
import assert from 'node:assert/strict';

import { parseChatArgs } from '../src/commands/chat.js';
import { parseRunArgs } from '../src/commands/run.js';
import { parseScopeArgs } from '../src/commands/skill.js';
import { parseArgs as parseWebArgs } from '../codemini-web/server.js';

test('CLI parsers preserve aliases, repeated skills, and positionals', () => {
  assert.deepEqual(parseChatArgs(['--lite', '--model', 'gpt', 'hello', 'world']), {
    prompt: 'hello world', sessionId: undefined, model: 'gpt', fast: true, system: undefined, plain: false,
  });
  assert.deepEqual(parseRunArgs(['--skill', 'one', '--skill=two', '--pipeline', 'do', 'it']), {
    task: 'do it', model: undefined, fast: false, harness: null, pipeline: true, skillNames: ['one', 'two'],
  });
  assert.deepEqual(parseScopeArgs(['install', '--scope=all', '--force'], { allowAll: true }), {
    scope: 'all', rest: ['install', '--force'],
  });
  assert.deepEqual(parseWebArgs(['node', 'server.js', '-p', '4567', '--no-open']), {
    port: 4567, session: undefined, model: undefined, project: undefined, open: false,
  });
});
