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
  packageHooksArmName,
  packageProfileArmEntry,
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
    const saved = await savePackageHookProfile({
      id: 'pkg-demo',
      name: 'Demo Package',
      packageSource: 'https://example.com/demo',
      packageName: 'Demo Package',
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

    const session = createSkillHooksSession();
    armSkillHooks(session, {
      name: 'later-skill',
      hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'skill.sh' }] }] },
    });
    armSkillHooks(session, packageProfileArmEntry(packages[0], cwd));
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
  } finally {
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
