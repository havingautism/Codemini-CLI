import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  installSkill,
  installSkillSource,
  snapshotSkillHooksDir,
  restoreSkillHooksDir
} from '../src/commands/skill.js';
import { getProjectSkillsDir } from '../src/core/paths.js';

const SKILL_CATALOG_FILE = 'codemini.skills.json';

async function withTempCwd(fn) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-skill-install-cwd-'));
  const fixtures = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-skill-install-fixtures-'));
  const prevGlobalDir = process.env.CODEMINI_GLOBAL_DIR;
  const globalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-skill-install-global-'));
  process.env.CODEMINI_GLOBAL_DIR = globalDir;
  try {
    return await fn({ cwd, fixtures });
  } finally {
    if (prevGlobalDir === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = prevGlobalDir;
    await fs.rm(cwd, { recursive: true, force: true });
    await fs.rm(fixtures, { recursive: true, force: true });
    await fs.rm(globalDir, { recursive: true, force: true });
  }
}

async function readCatalog(cwd) {
  const catalogPath = path.join(getProjectSkillsDir(cwd), SKILL_CATALOG_FILE);
  return JSON.parse(await fs.readFile(catalogPath, 'utf8'));
}

test('installSkill records frontmatter hook provenance in the catalog', async () => {
  await withTempCwd(async ({ cwd, fixtures }) => {
    const skillDir = path.join(fixtures, 'frontmatter-skill');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: frontmatter-skill
description: A skill with frontmatter hooks.
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: fm.sh
---
# Frontmatter Skill
`,
      'utf8'
    );

    const name = await installSkill(skillDir, { scope: 'project', cwd, sourceLabel: skillDir });
    assert.equal(name, 'frontmatter-skill');

    const catalog = await readCatalog(cwd);
    const entry = catalog.skills[name];
    assert.ok(entry, 'catalog entry should exist');
    assert.equal(entry.disableModelInvocation, false);
    assert.equal(entry.hooksProvenance.PreToolUse.source, 'frontmatter');
    assert.equal(entry.hooks, undefined, 'catalog should not duplicate the full hooks blob');
  });
});

test('installing a package with bare skill copies package hooks.json into the skill', async () => {
  await withTempCwd(async ({ cwd, fixtures }) => {
    const packageRoot = path.join(fixtures, 'package');
    const skillDir = path.join(packageRoot, 'skills', 'bare-skill');
    await fs.mkdir(path.join(packageRoot, 'hooks'), { recursive: true });
    await fs.mkdir(skillDir, { recursive: true });

    await fs.writeFile(
      path.join(packageRoot, 'hooks', 'hooks.json'),
      JSON.stringify({
        PreToolUse: [{ hooks: [{ type: 'command', command: 'pkg.sh' }] }]
      }),
      'utf8'
    );
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: bare-skill
description: A bare skill with no hooks of its own.
---
# Bare Skill
`,
      'utf8'
    );

    const installedNames = await installSkillSource(packageRoot, { scope: 'project', cwd });
    assert.deepEqual(installedNames, ['bare-skill']);

    const installedHooksPath = path.join(getProjectSkillsDir(cwd), 'bare-skill', 'hooks', 'hooks.json');
    const copiedHooks = JSON.parse(await fs.readFile(installedHooksPath, 'utf8'));
    assert.equal(copiedHooks.PreToolUse[0].hooks[0].command, 'pkg.sh');

    const catalog = await readCatalog(cwd);
    const entry = catalog.skills['bare-skill'];
    assert.ok(entry, 'catalog entry should exist');
    assert.equal(entry.disableModelInvocation, false);
    assert.equal(entry.hooksProvenance.PreToolUse.source, 'skill-json');
  });
});

test('installing a package does not overwrite a skill that already defines its own hooks', async () => {
  await withTempCwd(async ({ cwd, fixtures }) => {
    const packageRoot = path.join(fixtures, 'package');
    const skillDir = path.join(packageRoot, 'skills', 'self-contained-skill');
    await fs.mkdir(path.join(packageRoot, 'hooks'), { recursive: true });
    await fs.mkdir(path.join(skillDir, 'hooks'), { recursive: true });

    await fs.writeFile(
      path.join(packageRoot, 'hooks', 'hooks.json'),
      JSON.stringify({
        PreToolUse: [{ hooks: [{ type: 'command', command: 'pkg.sh' }] }]
      }),
      'utf8'
    );
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: self-contained-skill
description: Already has its own hooks.
---
# Self Contained Skill
`,
      'utf8'
    );
    await fs.writeFile(
      path.join(skillDir, 'hooks', 'hooks.json'),
      JSON.stringify({
        Stop: [{ hooks: [{ type: 'command', command: 'own.sh' }] }]
      }),
      'utf8'
    );

    await installSkillSource(packageRoot, { scope: 'project', cwd });

    const installedHooksPath = path.join(getProjectSkillsDir(cwd), 'self-contained-skill', 'hooks', 'hooks.json');
    const installedHooks = JSON.parse(await fs.readFile(installedHooksPath, 'utf8'));
    assert.equal(installedHooks.Stop[0].hooks[0].command, 'own.sh');

    const catalog = await readCatalog(cwd);
    assert.equal(catalog.skills['self-contained-skill'].hooksProvenance.Stop.source, 'skill-json');
  });
});

test('snapshotSkillHooksDir/restoreSkillHooksDir preserve local hooks across a reinstall', async () => {
  await withTempCwd(async ({ cwd, fixtures }) => {
    const skillDir = path.join(fixtures, 'local-hooks-skill');
    await fs.mkdir(path.join(skillDir, 'hooks'), { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: local-hooks-skill
description: Has local hooks that the update flow should preserve.
---
# Local Hooks Skill
`,
      'utf8'
    );
    await fs.writeFile(
      path.join(skillDir, 'hooks', 'hooks.json'),
      JSON.stringify({
        Stop: [{ hooks: [{ type: 'command', command: 'local-custom.sh' }] }]
      }),
      'utf8'
    );

    await installSkill(skillDir, { scope: 'project', cwd, sourceLabel: skillDir });
    const installedDir = path.join(getProjectSkillsDir(cwd), 'local-hooks-skill');

    // Simulate the preservation flow used by updateSkillPackage: snapshot the
    // locally-customized hooks/ dir before a package reinstall wipes it.
    const snapshot = await snapshotSkillHooksDir(installedDir);
    assert.ok(snapshot, 'expected a snapshot directory since hooks/ exists');

    // Reinstall from a fixture package that ships different (package) hooks,
    // which overwrites the previously installed skill without local hooks.
    const packageRoot = path.join(fixtures, 'package');
    const packageSkillDir = path.join(packageRoot, 'skills', 'local-hooks-skill');
    await fs.mkdir(path.join(packageRoot, 'hooks'), { recursive: true });
    await fs.mkdir(packageSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(packageRoot, 'hooks', 'hooks.json'),
      JSON.stringify({
        PreToolUse: [{ hooks: [{ type: 'command', command: 'pkg-replacement.sh' }] }]
      }),
      'utf8'
    );
    await fs.writeFile(
      path.join(packageSkillDir, 'SKILL.md'),
      `---
name: local-hooks-skill
description: Has local hooks that the update flow should preserve.
---
# Local Hooks Skill
`,
      'utf8'
    );

    await installSkillSource(packageRoot, { scope: 'project', cwd });

    const reinstalledHooksPath = path.join(installedDir, 'hooks', 'hooks.json');
    const reinstalledHooks = JSON.parse(await fs.readFile(reinstalledHooksPath, 'utf8'));
    assert.equal(reinstalledHooks.PreToolUse[0].hooks[0].command, 'pkg-replacement.sh');

    // Restore the snapshot, as updateSkillPackage does after reinstall when
    // resetHooks !== true, and confirm the local customization survives.
    await restoreSkillHooksDir(installedDir, snapshot);
    const restoredHooks = JSON.parse(await fs.readFile(reinstalledHooksPath, 'utf8'));
    assert.equal(restoredHooks.Stop[0].hooks[0].command, 'local-custom.sh');
    assert.equal(restoredHooks.PreToolUse, undefined);

    await fs.rm(snapshot, { recursive: true, force: true });
  });
});
