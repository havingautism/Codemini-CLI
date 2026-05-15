import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { handleSkill } from '../src/commands/skill.js';
import { loadCommandsAndSkills, renderCommandPrompt } from '../src/core/command-loader.js';

async function withTempSkillEnv(run) {
  const previousCwd = process.cwd();
  const previousGlobal = process.env.CODEMINI_GLOBAL_DIR;
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-skill-workspace-'));
  const globalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-skill-global-'));
  process.env.CODEMINI_GLOBAL_DIR = globalDir;
  process.chdir(workspace);
  try {
    await run({ workspace, globalDir });
  } finally {
    process.chdir(previousCwd);
    if (previousGlobal === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previousGlobal;
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(globalDir, { recursive: true, force: true });
  }
}

async function makeSourceSkill(parentDir, name) {
  const skillDir = path.join(parentDir, name);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, 'SKILL.md'),
    [
      '---',
      `name: ${name}`,
      `description: Use when ${name} is relevant.`,
      '---',
      '',
      'Run the reusable workflow.'
    ].join('\n'),
    'utf8'
  );
  return skillDir;
}

async function captureConsole(run) {
  const previous = console.log;
  const lines = [];
  console.log = (line = '') => lines.push(String(line));
  try {
    await run();
  } finally {
    console.log = previous;
  }
  return lines.join('\n');
}

test('skill install defaults to project scope and supports global scope', { concurrency: false }, async () => {
  await withTempSkillEnv(async ({ workspace, globalDir }) => {
    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-skill-source-'));
    try {
      const projectSource = await makeSourceSkill(sourceRoot, 'project-demo');
      const globalSource = await makeSourceSkill(sourceRoot, 'global-demo');

      await captureConsole(() => handleSkill(['install', projectSource]));
      await captureConsole(() => handleSkill(['install', '--scope=global', globalSource]));

      await fs.access(path.join(workspace, '.codemini', 'skills', 'project-demo', 'SKILL.md'));
      await fs.access(path.join(globalDir, 'skills', 'global-demo', 'SKILL.md'));

      const commands = await loadCommandsAndSkills(workspace);
      assert.equal(commands.get('project-demo')?.source, 'project-skill');
      assert.equal(commands.get('global-demo')?.source, 'global-skill');

      const listOutput = await captureConsole(() => handleSkill(['list']));
      assert.match(listOutput, /project-demo@0\.0\.0 \[project\] \(enabled\)/);
      assert.match(listOutput, /global-demo@0\.0\.0 \[global\] \(enabled\)/);
    } finally {
      await fs.rm(sourceRoot, { recursive: true, force: true });
    }
  });
});

test('builtin skills are always present and cannot be disabled or overwritten', { concurrency: false }, async () => {
  await withTempSkillEnv(async () => {
    await assert.rejects(
      () => handleSkill(['disable', 'superpowers-lite']),
      /builtin skill cannot be disabled: superpowers-lite/
    );

    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-skill-source-'));
    try {
      const bundledNameSource = await makeSourceSkill(sourceRoot, 'superpowers-lite');
      await assert.rejects(
        () => handleSkill(['install', bundledNameSource]),
        /cannot install over builtin skill: superpowers-lite/
      );

      const listOutput = await captureConsole(() => handleSkill(['list', '--scope=builtin']));
      assert.match(listOutput, /superpowers-lite@[\d.]+ \[builtin\] \(builtin\/default\)/);
      assert.match(listOutput, /grill-me@[\d.]+ \[builtin\] \(builtin\/default\)/);

      const commands = await loadCommandsAndSkills(process.cwd());
      const superpowersLite = commands.get('superpowers-lite');
      assert.match(superpowersLite?.content || '', /high-risk/i);
      assert.match(superpowersLite?.content || '', /1-3 sharp questions/i);
    } finally {
      await fs.rm(sourceRoot, { recursive: true, force: true });
    }
  });
});

test('top-level skill catalog provides routing metadata and project patches', { concurrency: false }, async () => {
  await withTempSkillEnv(async ({ workspace }) => {
    await fs.mkdir(path.join(workspace, '.codemini', 'skills'), { recursive: true });
    await fs.writeFile(
      path.join(workspace, '.codemini', 'skills', 'codemini.skills.json'),
      JSON.stringify({
        version: 1,
        skills: {
          brainstorm: {
            description: 'Project-specific brainstorm routing.',
            mode: 'manual',
            triggers: ['project_only'],
            priority: 99
          },
          stale_skill: {
            description: 'This catalog entry has no matching skill directory.',
            mode: 'agent_requested',
            triggers: ['never']
          }
        }
      }, null, 2),
      'utf8'
    );

    const commands = await loadCommandsAndSkills(workspace);
    const brainstorm = commands.get('brainstorm');

    assert.equal(brainstorm?.source, 'bundled-skill');
    assert.equal(brainstorm?.metadata?.description, 'Project-specific brainstorm routing.');
    assert.equal(brainstorm?.metadata?.mode, 'manual');
    assert.deepEqual(brainstorm?.metadata?.triggers, ['project_only']);
    assert.equal(brainstorm?.metadata?.priority, 99);
    assert.match(renderCommandPrompt(brainstorm, []), /Use this skill only when the task needs clarification/);
    assert.equal(commands.has('stale_skill'), false);
  });
});

test('skills continue to work when top-level catalog does not mention them', { concurrency: false }, async () => {
  await withTempSkillEnv(async ({ workspace }) => {
    await fs.mkdir(path.join(workspace, '.codemini', 'skills', 'uncataloged'), { recursive: true });
    await fs.writeFile(
      path.join(workspace, '.codemini', 'skills', 'codemini.skills.json'),
      JSON.stringify({ version: 1, skills: {} }, null, 2),
      'utf8'
    );
    await fs.writeFile(
      path.join(workspace, '.codemini', 'skills', 'uncataloged', 'SKILL.md'),
      [
        '---',
        'name: uncataloged',
        'description: Fallback skill from frontmatter.',
        'version: 1.2.3',
        '---',
        '',
        'Run the uncataloged workflow.'
      ].join('\n'),
      'utf8'
    );

    const commands = await loadCommandsAndSkills(workspace);
    const skill = commands.get('uncataloged');

    assert.equal(skill?.source, 'project-skill');
    assert.equal(skill?.metadata?.description, 'Fallback skill from frontmatter.');
    assert.equal(skill?.metadata?.version, '1.2.3');
    assert.match(renderCommandPrompt(skill, []), /Run the uncataloged workflow/);
  });
});

test('command rendering substitutes the local date for skill templates', { concurrency: false }, async () => {
  await withTempSkillEnv(async () => {
    const commands = await loadCommandsAndSkills(process.cwd());
    const command = commands.get('project-requirements');
    const rendered = renderCommandPrompt(command, []);
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const localDate = `${yyyy}-${mm}-${dd}`;

    assert.match(rendered, new RegExp(`docs/requirements/${localDate}-project-requirements\\.html`));
    assert.doesNotMatch(rendered, /YYYY-MM-DD-project-requirements/);
  });
});
