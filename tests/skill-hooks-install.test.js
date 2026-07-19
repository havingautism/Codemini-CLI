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
import { getSkillsDir } from '../src/core/paths.js';
import { discoverSkillHooks } from '../src/core/skill-hooks-discover.js';

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

async function readCatalog() {
  const catalogPath = path.join(getSkillsDir(), SKILL_CATALOG_FILE);
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

    const name = await installSkill(skillDir, { cwd, sourceLabel: skillDir });
    assert.equal(name, 'frontmatter-skill');

    const catalog = await readCatalog(cwd);
    const entry = catalog.skills[name];
    assert.ok(entry, 'catalog entry should exist');
    assert.equal(entry.disableModelInvocation, false);
    assert.equal(entry.hooksProvenance.PreToolUse.source, 'frontmatter');
    assert.equal(entry.hooks, undefined, 'catalog should not duplicate the full hooks blob');
  });
});

test('installSkill writes frontmatter mode and triggers into codemini.skills.json', async () => {
  await withTempCwd(async ({ cwd, fixtures }) => {
    const skillDir = path.join(fixtures, 'routing-skill');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: routing-skill
description: Routed remote skill.
mode: always
triggers: [deploy, release]
priority: 80
---
# Routing Skill
`,
      'utf8',
    );

    const name = await installSkill(skillDir, { cwd, sourceLabel: skillDir });
    const catalog = await readCatalog(cwd);
    const entry = catalog.skills[name];
    assert.equal(entry.mode, 'always');
    assert.deepEqual(entry.triggers, ['deploy', 'release']);
    assert.equal(entry.priority, 80);
    assert.equal(entry.description, 'Routed remote skill.');
  });
});

test('installSkill maps disable-model-invocation true to manual mode', async () => {
  await withTempCwd(async ({ cwd, fixtures }) => {
    const skillDir = path.join(fixtures, 'manual-from-flag');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: manual-from-flag
description: Claude manual-only skill.
disable-model-invocation: true
---
# Manual From Flag
`,
      'utf8',
    );

    const name = await installSkill(skillDir, { cwd, sourceLabel: skillDir });
    const catalog = await readCatalog(cwd);
    const entry = catalog.skills[name];
    assert.equal(entry.disableModelInvocation, true);
    assert.equal(entry.mode, 'manual');
    assert.equal(entry.routingAuthorLocked, true);
  });
});

test('installSkill maps disable-model-invocation false to agent_requested mode', async () => {
  await withTempCwd(async ({ cwd, fixtures }) => {
    const skillDir = path.join(fixtures, 'agent-from-flag');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: agent-from-flag
description: Claude agent-invocable skill.
disable-model-invocation: false
mode: always
---
# Agent From Flag
`,
      'utf8',
    );

    const name = await installSkill(skillDir, { cwd, sourceLabel: skillDir });
    const catalog = await readCatalog(cwd);
    const entry = catalog.skills[name];
    assert.equal(entry.disableModelInvocation, false);
    assert.equal(entry.mode, 'agent_requested');
    assert.equal(entry.routingAuthorLocked, true);
    assert.equal(entry.userInvocable, true);
  });
});

test('installSkill maps user-invocable false to agent_requested and locks routing', async () => {
  await withTempCwd(async ({ cwd, fixtures }) => {
    const skillDir = path.join(fixtures, 'model-only-skill');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: model-only-skill
description: Background knowledge skill.
user-invocable: false
---
# Model Only Skill
`,
      'utf8',
    );

    const name = await installSkill(skillDir, { cwd, sourceLabel: skillDir });
    const catalog = await readCatalog(cwd);
    const entry = catalog.skills[name];
    assert.equal(entry.userInvocable, false);
    assert.equal(entry.mode, 'agent_requested');
    assert.equal(entry.routingAuthorLocked, true);
    assert.equal(entry.disableModelInvocation, false);
  });
});

test('buildSkillUpdateCatalogPatch overlays Claude routing flags over prior mode', async () => {
  const { buildSkillUpdateCatalogPatch } = await import('../src/commands/skill.js');

  assert.deepEqual(
    buildSkillUpdateCatalogPatch(
      { mode: 'agent_requested', triggers: ['old'], enabled: true, priority: 40 },
      {
        disableModelInvocationPresent: true,
        disableModelInvocation: true,
        userInvocable: true,
        userInvocablePresent: false,
        mode: 'always',
      },
    ),
    {
      triggers: ['old'],
      enabled: true,
      priority: 40,
      routingAuthorLocked: true,
      userInvocable: true,
      disableModelInvocation: true,
      mode: 'manual',
    },
  );

  assert.deepEqual(
    buildSkillUpdateCatalogPatch(
      { mode: 'manual', triggers: [], enabled: true },
      {
        disableModelInvocationPresent: false,
        disableModelInvocation: false,
        userInvocablePresent: true,
        userInvocable: false,
      },
    ),
    {
      triggers: [],
      enabled: true,
      routingAuthorLocked: true,
      userInvocable: false,
      disableModelInvocation: false,
      mode: 'agent_requested',
    },
  );

  assert.deepEqual(
    buildSkillUpdateCatalogPatch(
      { mode: 'always', triggers: ['keep'], enabled: false },
      {
        disableModelInvocationPresent: false,
        disableModelInvocation: false,
        userInvocablePresent: false,
        userInvocable: true,
      },
    ),
    {
      triggers: ['keep'],
      enabled: false,
      routingAuthorLocked: false,
      userInvocable: true,
      mode: 'always',
    },
  );
});

test('installSkill can exclude bundled and frontmatter hooks', async () => {
  await withTempCwd(async ({ cwd, fixtures }) => {
    const skillDir = path.join(fixtures, 'no-hooks-skill');
    await fs.mkdir(path.join(skillDir, 'hooks'), { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: no-hooks-skill
description: Hooks should be excluded.
hooks:
  Stop:
    - hooks:
        - type: command
          command: frontmatter-stop.sh
---
# No Hooks Skill
`,
      'utf8',
    );
    await fs.writeFile(
      path.join(skillDir, 'hooks', 'hooks.json'),
      JSON.stringify({ PreToolUse: [{ hooks: [{ type: 'command', command: 'bundled.sh' }] }] }),
      'utf8',
    );

    await installSkill(skillDir, {
      cwd,
      sourceLabel: skillDir,
      includeHooks: false,
    });

    const installedDir = path.join(getSkillsDir(), 'no-hooks-skill');
    await assert.rejects(fs.access(path.join(installedDir, 'hooks', 'hooks.json')));
    await fs.access(path.join(installedDir, '.codemini-hooks-disabled'));
    const discovered = await discoverSkillHooks({ skillRoot: installedDir });
    assert.deepEqual(discovered.hooks, {});
    const catalog = await readCatalog(cwd);
    assert.equal(catalog.skills['no-hooks-skill'].hooksImported, false);
  });
});

test('installing a package saves package hooks as a profile, not into the skill', async () => {
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

    const installedNames = await installSkillSource(packageRoot, { cwd, includeHooks: true });
    assert.deepEqual(installedNames, ['bare-skill']);

    const installedDir = path.join(getSkillsDir(), 'bare-skill');
    await assert.rejects(fs.access(path.join(installedDir, 'hooks', 'hooks.json')));

    const discovered = await discoverSkillHooks({ skillRoot: installedDir });
    assert.deepEqual(discovered.hooks, {});

    const catalog = await readCatalog(cwd);
    const entry = catalog.skills['bare-skill'];
    assert.ok(entry, 'catalog entry should exist');
    assert.equal(entry.disableModelInvocation, false);
    assert.deepEqual(entry.hooksProvenance || {}, {});

    const { listPackageHookProfiles } = await import('../src/core/hook-profiles.js');
    const packages = await listPackageHookProfiles(cwd);
    assert.equal(packages.length, 1);
    assert.equal(packages[0].kind, 'package');
    assert.equal(packages[0].hooks.PreToolUse[0].hooks[0].command, 'pkg.sh');
    assert.equal(packages[0].enabled, true);
    assert.ok(packages[0].packageRoot.startsWith(path.join(process.env.CODEMINI_GLOBAL_DIR, 'hooks', 'packages')));
    assert.equal(path.isAbsolute(packages[0].packageRoot), true);
    assert.equal(
      JSON.parse(await fs.readFile(path.join(packages[0].packageRoot, 'hooks', 'hooks.json'), 'utf8'))
        .PreToolUse[0].hooks[0].command,
      'pkg.sh',
    );
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

    await installSkillSource(packageRoot, { cwd, includeHooks: true });

    const installedHooksPath = path.join(getSkillsDir(), 'self-contained-skill', 'hooks', 'hooks.json');
    const installedHooks = JSON.parse(await fs.readFile(installedHooksPath, 'utf8'));
    assert.equal(installedHooks.Stop[0].hooks[0].command, 'own.sh');

    const catalog = await readCatalog(cwd);
    assert.equal(catalog.skills['self-contained-skill'].hooksProvenance.Stop.source, 'skill-json');

    const { listPackageHookProfiles } = await import('../src/core/hook-profiles.js');
    const packages = await listPackageHookProfiles(cwd);
    assert.equal(packages.length, 1);
    assert.equal(packages[0].hooks.PreToolUse[0].hooks[0].command, 'pkg.sh');
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

    await installSkill(skillDir, { cwd, sourceLabel: skillDir });
    const installedDir = path.join(getSkillsDir(), 'local-hooks-skill');

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

    await installSkillSource(packageRoot, { cwd });

    const reinstalledHooksPath = path.join(installedDir, 'hooks', 'hooks.json');
    await assert.rejects(
      fs.access(reinstalledHooksPath),
      'package hooks must not be copied into the skill on reinstall',
    );

    const { listPackageHookProfiles } = await import('../src/core/hook-profiles.js');
    const packages = await listPackageHookProfiles(cwd);
    assert.equal(packages[0].hooks.PreToolUse[0].hooks[0].command, 'pkg-replacement.sh');

    // Restore the snapshot, as updateSkillPackage does after reinstall when
    // resetHooks !== true, and confirm the local customization survives.
    await restoreSkillHooksDir(installedDir, snapshot);
    const restoredHooks = JSON.parse(await fs.readFile(reinstalledHooksPath, 'utf8'));
    assert.equal(restoredHooks.Stop[0].hooks[0].command, 'local-custom.sh');
    assert.equal(restoredHooks.PreToolUse, undefined);

    await fs.rm(snapshot, { recursive: true, force: true });
  });
});
