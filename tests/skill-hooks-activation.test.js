import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildSkillIndexPreview,
  composeExplicitSkillPrompt,
  isSkillIndexEligible,
  isSkillModelInvocationDisabled
} from '../src/core/command-loader.js';
import { buildAlwaysSkillPromptBlock } from '../src/core/chat-runtime.js';
import { composeSelectedSkills } from '../src/core/chat-message.js';
import { getBuiltinTools } from '../src/core/tools.js';
import { getSkillsDir } from '../src/core/paths.js';

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

async function writeGlobalSkill(name, { catalogEntry = {}, frontmatter = '' } = {}) {
  const skillsDir = getSkillsDir();
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

test('skill index includes only agent-requested skills', () => {
  const manualSkill = { metadata: { type: 'skill', mode: 'manual' } };
  const alwaysSkill = { metadata: { type: 'skill', mode: 'always' } };
  const agentRequestedSkill = { metadata: { type: 'skill', mode: 'agent_requested' } };
  const notASkill = { metadata: { type: 'command', mode: 'manual' } };
  assert.equal(isSkillIndexEligible(manualSkill), false);
  assert.equal(isSkillIndexEligible(alwaysSkill), false);
  assert.equal(isSkillIndexEligible(agentRequestedSkill), true);
  assert.equal(isSkillIndexEligible(notASkill), false);
});

test('buildSkillIndexPreview returns raw debug JSON including frontmatter triggers', async () => {
  await withTempCwd(async (cwd) => {
    await writeGlobalSkill('with-triggers', {
      catalogEntry: { mode: 'agent_requested' },
      frontmatter: 'triggers: [review since X, code review]\n',
    });
    const preview = await buildSkillIndexPreview(cwd, {
      skills: {
        enabled: { 'with-triggers': true },
        contexts: { 'with-triggers': ['coding'] },
      },
    });
    assert.equal(preview.coding.context, 'coding');
    assert.equal(preview.coding.count, 1);
    assert.equal(preview.coding.skills[0].name, 'with-triggers');
    assert.deepEqual(preview.coding.skills[0].triggers, ['review since X', 'code review']);
    assert.match(preview.coding.prompt, /# Indexed skills/);
    assert.equal(preview.daily.count, 0);
    assert.equal(preview.global.count, 0);
  });
});

test('buildSkillIndexPreview global bucket lists skills bound to both contexts', async () => {
  await withTempCwd(async (cwd) => {
    await writeGlobalSkill('everywhere', {
      catalogEntry: { mode: 'agent_requested' },
    });
    await writeGlobalSkill('always-full-body', {
      catalogEntry: { mode: 'always' },
    });
    await writeGlobalSkill('manual-only', {
      catalogEntry: { mode: 'manual' },
    });
    const preview = await buildSkillIndexPreview(cwd, {
      skills: {
        enabled: { everywhere: true },
        contexts: {
          everywhere: ['coding', 'daily'],
          'always-full-body': ['coding', 'daily'],
          'manual-only': ['coding', 'daily'],
        },
      },
    });
    assert.equal(preview.global.count, 1);
    assert.equal(preview.global.skills[0].name, 'everywhere');
    // Panel coding/daily tabs must not list global-bound skills.
    assert.equal(preview.coding.count, 0);
    assert.equal(preview.daily.count, 0);
    // Runtime indexes still include them.
    assert.match(preview.coding.executionPrompt, /everywhere/);
    assert.match(preview.daily.executionPrompt, /everywhere/);
    assert.doesNotMatch(preview.coding.executionPrompt, /always-full-body|manual-only/);
    assert.doesNotMatch(preview.daily.executionPrompt, /always-full-body|manual-only/);
  });
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
    await writeGlobalSkill('locked-skill', { catalogEntry: { disableModelInvocation: true } });
    await writeGlobalSkill('open-skill', { catalogEntry: { disableModelInvocation: false } });

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
