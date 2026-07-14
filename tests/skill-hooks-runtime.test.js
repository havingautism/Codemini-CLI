import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSkillHooksSession, armSkillHooks, listArmedHandlers } from '../src/core/skill-hooks-session.js';
import { armSkillFromCommand, fireSkillHookEvent, resolveSkillRoot } from '../src/core/skill-hooks-runtime.js';

async function withFixture(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-hooks-runtime-'));
  try {
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function armUserPromptSkill(session, name, command, overrides = {}) {
  armSkillHooks(session, {
    name,
    hooks: {
      UserPromptSubmit: [{ hooks: [{ type: 'command', command, timeout: 5, failClosed: false }] }]
    },
    pluginRoot: `/plugins/${name}`,
    ...overrides
  });
}

test('fireSkillHookEvent runs UserPromptSubmit handlers and aggregates additionalContext', async () => {
  const session = createSkillHooksSession();
  armUserPromptSkill(session, 'alpha', 'alpha.sh');
  armUserPromptSkill(session, 'beta', 'beta.sh');

  const calls = [];
  const runCommandHookFn = async ({ command, env }) => {
    calls.push({ command, env });
    return {
      ok: true,
      decision: 'allow',
      additionalContext: `context from ${command}`
    };
  };

  const events = [];
  const result = await fireSkillHookEvent({
    session,
    eventName: 'UserPromptSubmit',
    input: { prompt: 'hello' },
    workspaceRoot: '/workspace',
    runCommandHookFn,
    onAgentEvent: (event) => events.push(event)
  });

  assert.equal(result.ok, true);
  assert.equal(result.denied, false);
  assert.deepEqual(result.contexts.sort(), ['context from alpha.sh', 'context from beta.sh'].sort());
  assert.equal(calls.length, 2);
  assert.equal(calls[0].env.CLAUDE_PROJECT_DIR, '/workspace');
  assert.ok(calls[0].env.CLAUDE_PLUGIN_ROOT.startsWith('/plugins/'));

  const startEvents = events.filter((event) => event.type === 'hook:start');
  const endEvents = events.filter((event) => event.type === 'hook:end');
  assert.equal(startEvents.length, 2);
  assert.equal(endEvents.length, 2);
  assert.ok(endEvents.every((event) => event.decision === 'allow'));
});

test('fireSkillHookEvent denies and short-circuits when a handler returns deny', async () => {
  const session = createSkillHooksSession();
  armUserPromptSkill(session, 'alpha', 'alpha.sh');
  armUserPromptSkill(session, 'beta', 'beta.sh');

  const calls = [];
  const runCommandHookFn = async ({ command }) => {
    calls.push(command);
    if (command === 'alpha.sh') {
      return { ok: true, decision: 'deny', reason: 'blocked by alpha' };
    }
    return { ok: true, decision: 'allow', additionalContext: 'should not appear' };
  };

  const result = await fireSkillHookEvent({
    session,
    eventName: 'UserPromptSubmit',
    workspaceRoot: '/workspace',
    runCommandHookFn
  });

  assert.equal(result.denied, true);
  assert.equal(result.reason, 'blocked by alpha');
  assert.equal(calls.length, 1, 'should stop after the first deny and not call remaining handlers');
  assert.deepEqual(result.contexts, []);
});

test('fireSkillHookEvent skips handlers whose matcher does not allow the tool name', async () => {
  const session = createSkillHooksSession();
  armSkillHooks(session, {
    name: 'alpha',
    hooks: {
      PreToolUse: [{ matcher: '^Bash$', hooks: [{ type: 'command', command: 'guard.sh', timeout: 5 }] }]
    },
    pluginRoot: '/plugins/alpha'
  });

  let called = 0;
  const runCommandHookFn = async () => {
    called += 1;
    return { ok: true, decision: 'allow' };
  };

  const result = await fireSkillHookEvent({
    session,
    eventName: 'PreToolUse',
    toolName: 'Read',
    runCommandHookFn
  });

  assert.equal(called, 0);
  assert.equal(result.denied, false);
});

test('fireSkillHookEvent treats a failed/fail-open hook result as non-fatal and continues', async () => {
  const session = createSkillHooksSession();
  armUserPromptSkill(session, 'alpha', 'alpha.sh');
  armUserPromptSkill(session, 'beta', 'beta.sh');

  const runCommandHookFn = async ({ command }) => {
    if (command === 'alpha.sh') return { ok: false, failOpen: true };
    return { ok: true, decision: 'allow', additionalContext: 'beta context' };
  };

  const errorEvents = [];
  const result = await fireSkillHookEvent({
    session,
    eventName: 'UserPromptSubmit',
    runCommandHookFn,
    onAgentEvent: (event) => {
      if (event.type === 'hook:end' && event.ok === false) errorEvents.push(event);
    }
  });

  assert.equal(result.denied, false);
  assert.deepEqual(result.contexts, ['beta context']);
  assert.equal(errorEvents.length, 1);
  assert.equal(errorEvents[0].skillName, 'alpha');
});

test('fireSkillHookEvent blocks when a failed hook is fail-closed', async () => {
  const session = createSkillHooksSession();
  armUserPromptSkill(session, 'guard', 'guard.sh');
  const result = await fireSkillHookEvent({
    session,
    eventName: 'UserPromptSubmit',
    runCommandHookFn: async () => ({
      ok: false,
      failClosed: true,
      decision: 'deny',
      reason: 'guard unavailable',
    }),
  });
  assert.equal(result.denied, true);
  assert.equal(result.reason, 'guard unavailable');
});

test('fireSkillHookEvent emits hook:error and continues when runCommandHookFn throws', async () => {
  const session = createSkillHooksSession();
  armUserPromptSkill(session, 'alpha', 'alpha.sh');

  const events = [];
  const result = await fireSkillHookEvent({
    session,
    eventName: 'UserPromptSubmit',
    runCommandHookFn: async () => {
      throw new Error('spawn failed');
    },
    onAgentEvent: (event) => events.push(event)
  });

  assert.equal(result.denied, false);
  assert.deepEqual(result.contexts, []);
  assert.equal(events.some((event) => event.type === 'hook:error' && event.error === 'spawn failed'), true);
});

test('fireSkillHookEvent can target a single package arm by skillName', async () => {
  const session = createSkillHooksSession();
  armSkillHooks(session, {
    name: '__package__:demo',
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: 'pkg.sh', timeout: 5 }] }],
    },
    provenance: { SessionStart: { source: 'package', packageName: 'Demo Package' } },
  });
  armUserPromptSkill(session, 'other-skill', 'skill.sh');

  const events = [];
  const result = await fireSkillHookEvent({
    session,
    eventName: 'SessionStart',
    skillName: '__package__:demo',
    runCommandHookFn: async () => ({
      ok: true,
      decision: 'allow',
      additionalContext: 'from-package',
    }),
    onAgentEvent: (event) => events.push(event),
  });

  assert.deepEqual(result.contexts, ['from-package']);
  assert.equal(events[0]?.name, 'Demo Package');
  assert.equal(events[0]?.source, 'package');
});

test('resolveSkillRoot prefers metadata.rootPath then falls back to path dirname', () => {
  assert.equal(resolveSkillRoot({ metadata: { rootPath: '/skills/foo' }, path: '/skills/foo/SKILL.md' }), '/skills/foo');
  assert.equal(resolveSkillRoot({ path: '/commands/bar.md' }), path.dirname('/commands/bar.md'));
  assert.equal(resolveSkillRoot(null), '');
});

test('armSkillFromCommand discovers hooks on disk and arms them on the session', async () => {
  await withFixture(async (root) => {
    const skillRoot = path.join(root, 'my-skill');
    await fs.mkdir(skillRoot, { recursive: true });
    await fs.writeFile(
      path.join(skillRoot, 'SKILL.md'),
      `---
hooks:
  UserPromptSubmit:
    - hooks:
        - type: command
          command: notify.sh
---
# My Skill
`,
      'utf8'
    );

    const session = createSkillHooksSession();
    const armed = await armSkillFromCommand(session, {
      name: 'my-skill',
      path: path.join(skillRoot, 'SKILL.md'),
      metadata: { rootPath: skillRoot }
    });

    assert.ok(armed);
    assert.equal(armed.skillRoot, skillRoot);
    const handlers = listArmedHandlers(session, 'UserPromptSubmit');
    assert.equal(handlers.length, 1);
    assert.equal(handlers[0].skillName, 'my-skill');
    assert.equal(handlers[0].handler.command, 'notify.sh');
    assert.equal(handlers[0].pluginRoot, skillRoot);
  });
});

test('armSkillFromCommand returns null when the skill defines no hooks', async () => {
  await withFixture(async (root) => {
    const skillRoot = path.join(root, 'plain-skill');
    await fs.mkdir(skillRoot, { recursive: true });
    await fs.writeFile(path.join(skillRoot, 'SKILL.md'), '# Plain skill, no hooks\n', 'utf8');

    const session = createSkillHooksSession();
    const armed = await armSkillFromCommand(session, {
      name: 'plain-skill',
      path: path.join(skillRoot, 'SKILL.md'),
      metadata: { rootPath: skillRoot }
    });

    assert.equal(armed, null);
    assert.equal(session.activeSkills.size, 0);
  });
});

test('armSkillFromCommand is a no-op for missing session, command name, or resolvable root', async () => {
  const session = createSkillHooksSession();
  assert.equal(await armSkillFromCommand(null, { name: 'x', path: '/a/b.md' }), null);
  assert.equal(await armSkillFromCommand(session, { name: '', path: '/a/b.md' }), null);
  assert.equal(await armSkillFromCommand(session, { name: 'x' }), null);
});
