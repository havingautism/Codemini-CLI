import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  discoverSkillHooks,
  readFrontmatterHooks,
  readHooksJson,
} from '../src/core/skill-hooks-discover.js';

async function withFixture(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-hooks-discover-'));
  try {
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('frontmatter PreToolUse resolves with frontmatter provenance', async () => {
  await withFixture(async (root) => {
    const skillRoot = path.join(root, 'skill');
    await fs.mkdir(skillRoot, { recursive: true });
    await fs.writeFile(
      path.join(skillRoot, 'SKILL.md'),
      `---
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: fm.sh
---
# Skill
`,
      'utf8',
    );

    const result = await discoverSkillHooks({ skillRoot });
    assert.equal(result.hooks.PreToolUse[0].hooks[0].command, 'fm.sh');
    assert.equal(result.provenance.PreToolUse.source, 'frontmatter');
    assert.equal(result.disableModelInvocation, false);
  });
});

test('frontmatter and skill-json keep different events', async () => {
  await withFixture(async (root) => {
    const skillRoot = path.join(root, 'skill');
    await fs.mkdir(path.join(skillRoot, 'hooks'), { recursive: true });
    await fs.writeFile(
      path.join(skillRoot, 'SKILL.md'),
      `---
hooks:
  PreToolUse:
    - hooks:
        - type: command
          command: fm.sh
---
`,
      'utf8',
    );
    await fs.writeFile(
      path.join(skillRoot, 'hooks', 'hooks.json'),
      JSON.stringify({
        Stop: [{ hooks: [{ type: 'command', command: 'skill-stop.sh' }] }],
      }),
      'utf8',
    );

    const result = await discoverSkillHooks({ skillRoot });
    assert.equal(result.hooks.PreToolUse[0].hooks[0].command, 'fm.sh');
    assert.equal(result.provenance.PreToolUse.source, 'frontmatter');
    assert.equal(result.hooks.Stop[0].hooks[0].command, 'skill-stop.sh');
    assert.equal(result.provenance.Stop.source, 'skill-json');
  });
});

test('package hooks are not merged into skill discovery', async () => {
  await withFixture(async (root) => {
    const skillRoot = path.join(root, 'skill');
    const packageRoot = path.join(root, 'package');
    await fs.mkdir(skillRoot, { recursive: true });
    await fs.mkdir(path.join(packageRoot, 'hooks'), { recursive: true });
    await fs.writeFile(path.join(skillRoot, 'SKILL.md'), '# Skill\n', 'utf8');
    await fs.writeFile(
      path.join(packageRoot, 'hooks', 'hooks.json'),
      JSON.stringify({
        PreToolUse: [{ hooks: [{ type: 'command', command: 'pkg.sh' }] }],
      }),
      'utf8',
    );

    const result = await discoverSkillHooks({ skillRoot, packageRoot });
    assert.deepEqual(result.hooks, {});
    assert.deepEqual(result.provenance, {});
  });
});

test('settings hooks ignored unless adoptSettings true', async () => {
  await withFixture(async (root) => {
    const skillRoot = path.join(root, 'skill');
    const packageRoot = path.join(root, 'package');
    await fs.mkdir(skillRoot, { recursive: true });
    await fs.mkdir(path.join(packageRoot, '.claude'), { recursive: true });
    await fs.writeFile(path.join(skillRoot, 'SKILL.md'), '# Skill\n', 'utf8');
    await fs.writeFile(
      path.join(packageRoot, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ hooks: [{ type: 'command', command: 'settings.sh' }] }],
        },
      }),
      'utf8',
    );

    const ignored = await discoverSkillHooks({ skillRoot, packageRoot, adoptSettings: false });
    assert.deepEqual(ignored.hooks, {});

    const adopted = await discoverSkillHooks({ skillRoot, packageRoot, adoptSettings: true });
    assert.equal(adopted.hooks.PreToolUse[0].hooks[0].command, 'settings.sh');
    assert.equal(adopted.provenance.PreToolUse.source, 'settings');
  });
});

test('readFrontmatterHooks returns disableModelInvocation from frontmatter', async () => {
  await withFixture(async (root) => {
    const skillMd = path.join(root, 'SKILL.md');

    await fs.writeFile(
      skillMd,
      `---
disableModelInvocation: true
hooks:
  Stop:
    - hooks:
        - type: command
          command: stop.sh
---
`,
      'utf8',
    );
    const camel = await readFrontmatterHooks(skillMd);
    assert.equal(camel.disableModelInvocation, true);
    assert.equal(camel.hooks.Stop[0].hooks[0].command, 'stop.sh');

    await fs.writeFile(
      skillMd,
      `---
disable-model-invocation: true
---
`,
      'utf8',
    );
    const kebab = await readFrontmatterHooks(skillMd);
    assert.equal(kebab.disableModelInvocation, true);
    assert.deepEqual(kebab.hooks, {});
  });
});

test('readHooksJson returns empty object for missing file', async () => {
  await withFixture(async (root) => {
    const missing = path.join(root, 'missing-hooks.json');
    assert.deepEqual(await readHooksJson(missing), {});
  });
});

test('readHooksJson normalizes valid hooks json', async () => {
  await withFixture(async (root) => {
    const filePath = path.join(root, 'hooks.json');
    await fs.writeFile(
      filePath,
      JSON.stringify({
        PreToolUse: [{ hooks: [{ type: 'command', command: 'ok.sh' }] }],
        UnknownEvent: [{ hooks: [{ type: 'command', command: 'skip.sh' }] }],
      }),
      'utf8',
    );

    const hooks = await readHooksJson(filePath);
    assert.equal(hooks.PreToolUse[0].hooks[0].command, 'ok.sh');
    assert.equal(hooks.UnknownEvent, undefined);
  });
});
