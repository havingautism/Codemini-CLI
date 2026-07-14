import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  composeExplicitSkillPrompt,
  isSkillIndexEligible,
  isSkillModelInvocationDisabled
} from '../src/core/command-loader.js';
import { buildAlwaysSkillPromptBlock } from '../src/core/chat-runtime.js';
import { composeSelectedSkills } from '../src/core/chat-message.js';
import { getBuiltinTools } from '../src/core/tools.js';

async function withTempCwd(fn) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-skill-activation-cwd-'));
  const prevGlobalDir = process.env.CODEMINI_GLOBAL_DIR;
  const globalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-skill-activation-global-'));
  process.env.CODEMINI_GLOBAL_DIR = globalDir;
  try {
    return await fn(cwd);
  } finally {
    if (prevGlobalDir === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = prevGlobalDir;
    await fs.rm(cwd, { recursive: true, force: true });
    await fs.rm(globalDir, { recursive: true, force: true });
  }
}

async function writeProjectSkill(cwd, name, { catalogEntry = {}, frontmatter = '' } = {}) {
  const skillsDir = path.join(cwd, '.codemini', 'skills');
  const skillDir = path.join(skillsDir, name);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Test skill ${name}\n${frontmatter}---\n# ${name}\n\nDo the thing.\n`,
    'utf8'
  );
  const catalogPath = path.join(skillsDir, 'codemini.skills.json');
  let catalog = { skills: {} };
  try {
    catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
  } catch {}
  catalog.skills = catalog.skills || {};
  catalog.skills[name] = { description: `Test skill ${name}`, ...catalogEntry };
  await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2), 'utf8');
}

test('skill index omits manual skills but includes agent-requested and always skills', () => {
  const manualSkill = { metadata: { type: 'skill', mode: 'manual' } };
  const alwaysSkill = { metadata: { type: 'skill', mode: 'always' } };
  const notASkill = { metadata: { type: 'command', mode: 'manual' } };
  assert.equal(isSkillIndexEligible(manualSkill), false);
  assert.equal(isSkillIndexEligible(alwaysSkill), true);
  assert.equal(isSkillIndexEligible(notASkill), false);
});

test('isSkillModelInvocationDisabled recognizes camelCase and kebab-case, boolean and string forms', () => {
  assert.equal(isSkillModelInvocationDisabled({ metadata: { disableModelInvocation: true } }), true);
  assert.equal(isSkillModelInvocationDisabled({ metadata: { disableModelInvocation: 'true' } }), true);
  assert.equal(isSkillModelInvocationDisabled({ metadata: { 'disable-model-invocation': true } }), true);
  assert.equal(isSkillModelInvocationDisabled({ metadata: { 'disable-model-invocation': 'true' } }), true);
  assert.equal(isSkillModelInvocationDisabled({ metadata: { disableModelInvocation: false } }), false);
  assert.equal(isSkillModelInvocationDisabled({ metadata: {} }), false);
  assert.equal(isSkillModelInvocationDisabled(null), false);
});

test('buildAlwaysSkillPromptBlock injects enabled always-mode skill bodies', () => {
  const commands = new Map([
    [
      'my-always-skill',
      {
        name: 'my-always-skill',
        metadata: { type: 'skill', mode: 'always', priority: 10 },
        content: 'SECRET ALWAYS SKILL BODY THAT MUST NOT LEAK INTO THE PROMPT'
      }
    ]
  ]);
  const block = buildAlwaysSkillPromptBlock(commands, {}, null, 'normal');
  assert.match(block, /\[Always skill: my-always-skill\]/);
  assert.match(block, /SECRET ALWAYS SKILL BODY/);
});

test('composeSelectedSkills still composes a manually-selected skill even when disableModelInvocation is true', () => {
  const commands = new Map([
    [
      'locked-skill',
      {
        name: 'locked-skill',
        metadata: { type: 'skill', disableModelInvocation: true, enabled: true },
        content: 'Manual skill body content.'
      }
    ]
  ]);
  const composed = composeSelectedSkills(commands, { text: 'help me', skillNames: ['locked-skill'] });
  assert.equal(composed.error, undefined);
  assert.match(composed.modelText, /Manual skill body content\./);
});

test('composeExplicitSkillPrompt is not gated by disableModelInvocation', () => {
  const commands = new Map([
    [
      'locked-skill',
      {
        name: 'locked-skill',
        metadata: { type: 'skill', disableModelInvocation: true },
        content: 'Manual skill body content.'
      }
    ]
  ]);
  const result = composeExplicitSkillPrompt(commands, ['locked-skill'], 'task text');
  assert.equal(result.error, undefined);
  assert.match(result.prompt, /Manual skill body content\./);
});

test('skill tool blocks loading a skill by name when disableModelInvocation is true, but still lists it', async () => {
  await withTempCwd(async (cwd) => {
    await writeProjectSkill(cwd, 'locked-skill', { catalogEntry: { disableModelInvocation: true } });
    await writeProjectSkill(cwd, 'open-skill', { catalogEntry: { disableModelInvocation: false } });

    const config = { execution: { mode: 'plan' } };
    const { handlers } = getBuiltinTools({ workspaceRoot: cwd, config });

    const listResult = await handlers.skill({ name: 'list' });
    const lockedSummary = listResult.skills.find((item) => item.name === 'locked-skill');
    const openSummary = listResult.skills.find((item) => item.name === 'open-skill');
    assert.ok(lockedSummary, 'locked skill should still appear in the index listing');
    assert.equal(lockedSummary.disableModelInvocation, true);
    assert.equal(openSummary.disableModelInvocation, false);

    const loadResult = await handlers.skill({ name: 'locked-skill' });
    assert.equal(
      loadResult.error,
      'Skill "locked-skill" disables model invocation. Ask the user to select it manually.'
    );

    const openLoadResult = await handlers.skill({ name: 'open-skill' });
    assert.equal(openLoadResult.error, undefined);
    assert.match(openLoadResult.content, /Do the thing\./);
  });
});
