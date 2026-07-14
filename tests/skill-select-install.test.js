import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  installSkillSource,
  previewSkillSource,
} from '../src/commands/skill.js';
import { getProjectSkillsDir } from '../src/core/paths.js';

async function withTempCwd(fn) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-skill-select-cwd-'));
  const fixtures = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-skill-select-fx-'));
  const prevGlobalDir = process.env.CODEMINI_GLOBAL_DIR;
  const globalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-skill-select-global-'));
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

async function writePackage(fixtures) {
  const packageRoot = path.join(fixtures, 'multi-package');
  for (const name of ['alpha-skill', 'beta-skill']) {
    const skillDir = path.join(packageRoot, 'skills', name);
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: ${name}
description: Skill ${name}
---
# ${name}
`,
      'utf8',
    );
  }
  await fs.mkdir(path.join(packageRoot, '.claude-plugin'), { recursive: true });
  await fs.writeFile(
    path.join(packageRoot, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'multi-package', skills: './skills' }),
    'utf8',
  );
  return packageRoot;
}

test('previewSkillSource lists package skills without installing', async () => {
  await withTempCwd(async ({ cwd, fixtures }) => {
    const packageRoot = await writePackage(fixtures);
    const preview = await previewSkillSource(packageRoot, { cwd });
    assert.equal(preview.packageName, 'multi-package');
    assert.deepEqual(
      preview.skills.map((skill) => skill.name).sort(),
      ['alpha-skill', 'beta-skill'],
    );
    await assert.rejects(fs.access(path.join(getProjectSkillsDir(cwd), 'alpha-skill')));
  });
});

test('installSkillSource can install a subset of package skills', async () => {
  await withTempCwd(async ({ cwd, fixtures }) => {
    const packageRoot = await writePackage(fixtures);
    const installed = await installSkillSource(packageRoot, {
      scope: 'project',
      cwd,
      includeHooks: false,
      skillNames: ['beta-skill'],
    });
    assert.deepEqual(installed, ['beta-skill']);
    await fs.access(path.join(getProjectSkillsDir(cwd), 'beta-skill', 'SKILL.md'));
    await assert.rejects(fs.access(path.join(getProjectSkillsDir(cwd), 'alpha-skill')));
  });
});

test('installSkillSource defaults to excluding hooks', async () => {
  await withTempCwd(async ({ cwd, fixtures }) => {
    const packageRoot = path.join(fixtures, 'hooks-package');
    const skillDir = path.join(packageRoot, 'skills', 'hooked');
    await fs.mkdir(path.join(packageRoot, 'hooks'), { recursive: true });
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(packageRoot, 'hooks', 'hooks.json'),
      JSON.stringify({ SessionStart: [{ hooks: [{ type: 'command', command: 'x.sh' }] }] }),
      'utf8',
    );
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: hooked
description: Hooked skill
---
# Hooked
`,
      'utf8',
    );

    await installSkillSource(packageRoot, { scope: 'project', cwd });
    const { listPackageHookProfiles } = await import('../src/core/hook-profiles.js');
    const packages = await listPackageHookProfiles(cwd);
    assert.equal(packages.length, 1);
    assert.equal(packages[0].enabled, false);
  });
});
