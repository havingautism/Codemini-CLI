import test from 'node:test';
import assert from 'node:assert/strict';
import {
  armSkillHooks,
  createSkillHooksSession,
  disarmSkillHooks,
  listArmedHandlers,
  matcherAllows,
} from '../src/core/skill-hooks-session.js';

const preToolHandler = { type: 'command', command: 'block.sh', timeout: 30, failClosed: true };

function makeSkillEntry(name, overrides = {}) {
  return {
    name,
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [preToolHandler],
        },
      ],
    },
    provenance: {
      PreToolUse: { source: 'frontmatter', priority: 1 },
    },
    packageKey: `pkg:${name}`,
    pluginRoot: `/plugins/${name}`,
    ...overrides,
  };
}

test('arm then listArmedHandlers returns PreToolUse handlers', () => {
  const session = createSkillHooksSession();
  const entry = makeSkillEntry('lint-skill');

  armSkillHooks(session, entry);
  const handlers = listArmedHandlers(session, 'PreToolUse');

  assert.equal(handlers.length, 1);
  assert.equal(handlers[0].skillName, 'lint-skill');
  assert.equal(handlers[0].matcher, 'Bash');
  assert.deepEqual(handlers[0].handler, preToolHandler);
  assert.equal(handlers[0].pluginRoot, '/plugins/lint-skill');
  assert.deepEqual(handlers[0].provenance, { source: 'frontmatter', priority: 1 });
});

test('disarm removes armed handlers', () => {
  const session = createSkillHooksSession();
  armSkillHooks(session, makeSkillEntry('lint-skill'));

  disarmSkillHooks(session, 'lint-skill');

  assert.equal(listArmedHandlers(session, 'PreToolUse').length, 0);
  assert.equal(session.activeSkills.size, 0);
});

test('matcherAllows handles empty matcher, regex, and invalid regex fallback', () => {
  assert.equal(matcherAllows(undefined, 'Bash'), true);
  assert.equal(matcherAllows('', 'Bash'), true);

  assert.equal(matcherAllows('^Bash$', 'Bash'), true);
  assert.equal(matcherAllows('^Bash$', 'Read'), false);

  assert.equal(matcherAllows('[invalid', 'Bash'), false);
  assert.equal(matcherAllows('[invalid', '[invalid'), true);
});

test('multiple skills both contribute handlers', () => {
  const session = createSkillHooksSession();
  const firstHandler = { type: 'command', command: 'one.sh', timeout: 30, failClosed: false };
  const secondHandler = { type: 'command', command: 'two.sh', timeout: 30, failClosed: false };

  armSkillHooks(session, {
    name: 'alpha',
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [firstHandler] }],
    },
    provenance: { PreToolUse: { source: 'frontmatter', priority: 1 } },
    pluginRoot: '/plugins/alpha',
  });
  armSkillHooks(session, {
    name: 'beta',
    hooks: {
      PreToolUse: [{ hooks: [secondHandler] }],
    },
    provenance: { PreToolUse: { source: 'package', priority: 3 } },
    pluginRoot: '/plugins/beta',
  });

  const handlers = listArmedHandlers(session, 'PreToolUse');

  assert.equal(handlers.length, 2);
  assert.deepEqual(
    handlers.map((item) => item.skillName).sort(),
    ['alpha', 'beta'],
  );
  assert.deepEqual(handlers.find((item) => item.skillName === 'alpha').handler, firstHandler);
  assert.deepEqual(handlers.find((item) => item.skillName === 'beta').handler, secondHandler);
});
