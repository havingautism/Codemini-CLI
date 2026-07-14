import test from 'node:test';
import assert from 'node:assert/strict';
import { HOOK_EVENTS } from '../src/core/skill-hooks-constants.js';
import { resolveHooksByPriority } from '../src/core/skill-hooks-normalize.js';

test('supported events include SessionStart and tool lifecycle', () => {
  for (const name of [
    'SessionStart',
    'UserPromptSubmit',
    'PreToolUse',
    'PostToolUse',
    'Stop',
  ]) {
    assert.ok(HOOK_EVENTS.has(name));
  }
});

test('editable skill json beats frontmatter and package for the same event', () => {
  const resolved = resolveHooksByPriority([
    {
      source: 'package',
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'pkg.sh' }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'pkg-stop.sh' }] }],
      },
    },
    {
      source: 'skill-json',
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'skill.sh' }] }],
      },
    },
    {
      source: 'frontmatter',
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'fm.sh' }] }],
      },
    },
  ]);
  assert.equal(resolved.hooks.PreToolUse[0].hooks[0].command, 'skill.sh');
  assert.equal(resolved.provenance.PreToolUse.source, 'skill-json');
  assert.equal(resolved.hooks.Stop[0].hooks[0].command, 'pkg-stop.sh');
  assert.equal(resolved.provenance.Stop.source, 'package');
});

test('settings source ignored unless adoptSettings true', () => {
  const resolved = resolveHooksByPriority(
    [
      {
        source: 'settings',
        hooks: {
          PreToolUse: [{ hooks: [{ type: 'command', command: 'settings.sh' }] }],
        },
      },
    ],
    { adoptSettings: false },
  );
  assert.deepEqual(resolved.hooks, {});
});

test('adoptSettings true keeps settings-sourced hooks when no higher source exists', () => {
  const resolved = resolveHooksByPriority(
    [
      {
        source: 'settings',
        hooks: {
          PreToolUse: [{ hooks: [{ type: 'command', command: 'settings.sh' }] }],
        },
      },
    ],
    { adoptSettings: true },
  );
  assert.equal(resolved.hooks.PreToolUse[0].hooks[0].command, 'settings.sh');
  assert.equal(resolved.provenance.PreToolUse.source, 'settings');
});
