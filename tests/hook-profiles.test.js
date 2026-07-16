import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  deleteCustomHookProfile,
  hookProfileIsActive,
  listCustomHookProfiles,
  listPackageHookProfiles,
  mergeHookProfileHooks,
  packageHookInstallRoot,
  packageHooksArmName,
  packageProfileArmEntry,
  persistPackageHookRoot,
  saveCustomHookProfile,
  savePackageHookProfile,
} from '../src/core/hook-profiles.js';
import {
  armSkillHooks,
  createSkillHooksSession,
  listArmedHandlers,
  PROJECT_HOOKS_SKILL_NAME,
} from '../src/core/skill-hooks-session.js';

test('custom hook profiles persist, filter by mode, and stack handlers', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-hook-profiles-'));
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = path.join(cwd, 'global');
  try {
    await saveCustomHookProfile({
      id: 'quality',
      name: 'Quality',
      scope: 'project',
      activation: 'coding',
      hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'lint.mjs' }] }] },
    }, cwd);
    await saveCustomHookProfile({
      id: 'audit',
      name: 'Audit',
      scope: 'global',
      activation: 'always',
      hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'audit.mjs' }] }] },
    }, cwd);

    const profiles = await listCustomHookProfiles(cwd);
    assert.equal(profiles.length, 2);
    assert.equal(profiles.filter((profile) => hookProfileIsActive(profile, 'plan')).length, 2);
    assert.equal(profiles.filter((profile) => hookProfileIsActive(profile, 'normal')).length, 1);
    const merged = mergeHookProfileHooks(profiles);
    assert.deepEqual(
      merged.PostToolUse.map((group) => group.hooks[0].command).sort(),
      ['audit.mjs', 'lint.mjs'],
    );

    await deleteCustomHookProfile({ id: 'quality', scope: 'project' }, cwd);
    assert.equal((await listCustomHookProfiles(cwd)).length, 1);
  } finally {
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('package hook profiles persist and arm after workspace, before skills', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-hook-package-'));
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = path.join(cwd, 'global');
  try {
    const sourceRoot = path.join(cwd, 'package-source');
    await fs.mkdir(path.join(sourceRoot, 'scripts'), { recursive: true });
    await fs.writeFile(path.join(sourceRoot, 'scripts', 'start.mjs'), 'console.log("ok");\n');
    const managedRoot = await persistPackageHookRoot(sourceRoot, {
      scope: 'project',
      cwd,
      id: 'pkg-demo',
    });
    const saved = await savePackageHookProfile({
      id: 'pkg-demo',
      name: 'Demo Package',
      packageSource: 'https://example.com/demo',
      packageName: 'Demo Package',
      packageRoot: managedRoot,
      scope: 'project',
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'pkg-start.sh' }] }],
        PreToolUse: [{ hooks: [{ type: 'command', command: 'pkg.sh' }] }],
      },
    }, cwd);

    assert.equal(saved.kind, 'package');
    assert.equal(saved.editable, false);
    const packages = await listPackageHookProfiles(cwd);
    assert.equal(packages.length, 1);
    assert.equal(packages[0].hooks.SessionStart[0].hooks[0].command, 'pkg-start.sh');
    assert.equal(packages[0].packageRoot, packageHookInstallRoot('project', cwd, 'pkg-demo'));
    assert.equal(await fs.readFile(path.join(packages[0].packageRoot, 'scripts', 'start.mjs'), 'utf8'), 'console.log("ok");\n');

    const session = createSkillHooksSession();
    armSkillHooks(session, {
      name: 'later-skill',
      hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'skill.sh' }] }] },
    });
    const packageEntry = packageProfileArmEntry(packages[0], cwd);
    assert.equal(packageEntry.pluginRoot, packages[0].packageRoot);
    armSkillHooks(session, packageEntry);
    armSkillHooks(session, {
      name: PROJECT_HOOKS_SKILL_NAME,
      hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'workspace.sh' }] }] },
    });

    const handlers = listArmedHandlers(session, 'PreToolUse');
    assert.deepEqual(
      handlers.map((item) => item.handler.command),
      ['workspace.sh', 'pkg.sh', 'skill.sh'],
    );
    assert.deepEqual(
      handlers.map((item) => item.source),
      ['project', 'package', 'skill'],
    );
    assert.equal(handlers[1].skillName, packageHooksArmName('pkg-demo'));
    await deleteCustomHookProfile({ id: 'pkg-demo', scope: 'project' }, cwd);
    await assert.rejects(fs.access(managedRoot));
  } finally {
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
