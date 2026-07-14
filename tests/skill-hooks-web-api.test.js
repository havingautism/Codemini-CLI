import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disableSkillHooks, writeSkillHooksJson, discoverSkillHooks } from '../src/core/skill-hooks-discover.js';
import { normalizeSkillMetadataPatch } from '../codemini-web/server.js';

async function withFixture(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-hooks-web-api-'));
  try {
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('writeSkillHooksJson preserves unsupported fields while runtime discovery normalizes them', async () => {
  await withFixture(async (root) => {
    const skillRoot = path.join(root, 'skill');
    await fs.mkdir(skillRoot, { recursive: true });

    const written = await writeSkillHooksJson(skillRoot, {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'guard.sh' }] }
      ],
      UnknownEvent: [{ hooks: [{ type: 'command', command: 'skip.sh' }] }]
    });

    assert.equal(written.PreToolUse[0].hooks[0].command, 'guard.sh');
    assert.equal(written.UnknownEvent[0].hooks[0].command, 'skip.sh');

    const raw = await fs.readFile(path.join(skillRoot, 'hooks', 'hooks.json'), 'utf8');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.PreToolUse[0].matcher, 'Bash');

    const discovered = await discoverSkillHooks({ skillRoot });
    assert.equal(discovered.hooks.PreToolUse[0].hooks[0].command, 'guard.sh');
    assert.equal(discovered.hooks.UnknownEvent, undefined);
    assert.equal(discovered.provenance.PreToolUse.source, 'skill-json');
  });
});

test('writeSkillHooksJson overwrites prior contents and creates hooks dir', async () => {
  await withFixture(async (root) => {
    const skillRoot = path.join(root, 'skill');
    await fs.mkdir(skillRoot, { recursive: true });

    await writeSkillHooksJson(skillRoot, {
      Stop: [{ hooks: [{ type: 'command', command: 'first.sh' }] }]
    });
    await writeSkillHooksJson(skillRoot, {
      Stop: [{ hooks: [{ type: 'command', command: 'second.sh' }] }]
    });

    const raw = await fs.readFile(path.join(skillRoot, 'hooks', 'hooks.json'), 'utf8');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.Stop[0].hooks[0].command, 'second.sh');
  });
});

test('writeSkillHooksJson stores empty/unsupported definitions without activating them', async () => {
  await withFixture(async (root) => {
    const skillRoot = path.join(root, 'skill');
    await fs.mkdir(skillRoot, { recursive: true });

    const written = await writeSkillHooksJson(skillRoot, {
      PreToolUse: [{ hooks: [] }, { hooks: [{ type: 'command', command: '' }] }]
    });

    assert.equal(written.PreToolUse.length, 2);
    const discovered = await discoverSkillHooks({ skillRoot });
    assert.deepEqual(discovered.hooks, {});
  });
});

test('normalizeSkillMetadataPatch accepts disableModelInvocation boolean', () => {
  assert.deepEqual(normalizeSkillMetadataPatch({ disableModelInvocation: true }), {
    disableModelInvocation: true
  });
  assert.deepEqual(normalizeSkillMetadataPatch({ disableModelInvocation: false }), {
    disableModelInvocation: false
  });
  assert.deepEqual(normalizeSkillMetadataPatch({ disableModelInvocation: 'true' }), {
    disableModelInvocation: false
  });
});

test('normalizeSkillMetadataPatch still accepts legacy mode for read/compat', () => {
  const patch = normalizeSkillMetadataPatch({ mode: 'always' });
  assert.equal(patch.mode, 'always');
  assert.equal(patch.disableModelInvocation, undefined);
});

test('normalizeSkillMetadataPatch keeps manual routing separate from hook metadata', () => {
  const patch = normalizeSkillMetadataPatch({ mode: 'manual' });
  assert.equal(patch.mode, 'manual');
  assert.equal(patch.disableModelInvocation, undefined);
});

test('deleting a skill hook profile disables bundled JSON and frontmatter hooks', async () => {
  await withFixture(async (root) => {
    const skillRoot = path.join(root, 'skill');
    await fs.mkdir(path.join(skillRoot, 'hooks'), { recursive: true });
    await fs.writeFile(
      path.join(skillRoot, 'SKILL.md'),
      '---\nhooks:\n  Stop:\n    - hooks:\n        - type: command\n          command: from-frontmatter\n---\n',
      'utf8',
    );
    await writeSkillHooksJson(skillRoot, {
      Stop: [{ hooks: [{ type: 'command', command: 'from-json' }] }],
    });

    await disableSkillHooks(skillRoot);
    const discovered = await discoverSkillHooks({ skillRoot });
    assert.equal(discovered.disabled, true);
    assert.deepEqual(discovered.hooks, {});
  });
});

test('normalizeSkillMetadataPatch preserves an explicit hook compatibility flag independently', () => {
  const patch = normalizeSkillMetadataPatch({ mode: 'manual', disableModelInvocation: false });
  assert.equal(patch.disableModelInvocation, false);
});

test('normalizeSkillMetadataPatch ignores unrelated fields and keeps contexts/triggers behavior', () => {
  const patch = normalizeSkillMetadataPatch({
    description: '  hello  ',
    triggers: 'a, b , c',
    priority: 500,
    enabled: false
  });
  assert.equal(patch.description, 'hello');
  assert.deepEqual(patch.triggers, ['a', 'b', 'c']);
  assert.equal(patch.priority, 100);
  assert.equal(patch.enabled, false);
  assert.equal(patch.disableModelInvocation, undefined);
});
