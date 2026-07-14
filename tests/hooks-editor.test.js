import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hooksObjectToState,
  hooksStateIsDirty,
  hooksStateToObject,
} from '../codemini-web/client/src/lib/hooks-editor.js';

test('hooks editor round-trips advanced and unsupported config without changes', () => {
  const hooks = {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [
          { type: 'command', command: 'guard.mjs', timeout: 12, failClosed: true },
          { type: 'prompt', prompt: 'check this' },
        ],
      },
      { matcher: 'Write', hooks: [{ type: 'command', command: 'audit.mjs' }] },
    ],
    Notification: [{ hooks: [{ type: 'http', url: 'https://example.invalid/hook' }] }],
  };
  const state = hooksObjectToState(hooks);
  assert.equal(hooksStateIsDirty(state), false);
  assert.deepEqual(hooksStateToObject(state), hooks);
});

test('editing the primary command preserves additional handlers and fields', () => {
  const hooks = {
    PreToolUse: [{
      matcher: 'Bash',
      hooks: [
        { type: 'command', command: 'old.mjs', timeout: 9, failClosed: true },
        { type: 'command', command: 'second.mjs', timeout: 4 },
      ],
    }],
  };
  const state = hooksObjectToState(hooks);
  state.PreToolUse = { ...state.PreToolUse, command: 'new.mjs', dirty: true };
  const saved = hooksStateToObject(state);
  assert.equal(saved.PreToolUse[0].hooks[0].command, 'new.mjs');
  assert.equal(saved.PreToolUse[0].hooks[0].timeout, 9);
  assert.equal(saved.PreToolUse[0].hooks[0].failClosed, true);
  assert.equal(saved.PreToolUse[0].hooks[1].command, 'second.mjs');
});
