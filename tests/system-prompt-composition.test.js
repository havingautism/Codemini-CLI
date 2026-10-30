import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDefaultSystemPrompt } from '../src/core/default-system-prompt.js';
import { buildExecutionModePromptBlock } from '../src/core/chat-runtime.js';
import { composeSystemPrompt } from '../src/core/system-prompt-composer.js';
import { resolveShellContext } from '../src/core/shell-profile.js';
import { buildCrewModePromptBlock } from '../src/core/crew-store.js';

// Check the assembled layers: individual prompt budgets miss repeated rules
// and mode leakage introduced by composition.
const environments = [
  ...['win32', 'linux', 'darwin'].map((platform) => ({ platform, backend: 'direct', sandbox: { enabled: false } })),
  { platform: 'win32', backend: 'vm', sandbox: { enabled: true, backend: 'microsandbox', mode: 'workspace-write' } },
  { platform: 'linux', backend: 'os', sandbox: { enabled: true, backend: 'os', mode: 'read-only' } },
  { platform: 'darwin', backend: 'os', sandbox: { enabled: true, backend: 'os', mode: 'workspace-write' } },
];
for (const { platform, backend, sandbox } of environments) {
  for (const mode of ['normal', 'coding']) {
    test(`${platform}/${backend}/${mode} composes each owned layer once and keeps memory last`, async () => {
      const config = {
        sandbox,
        soul: { coding: 'Default', daily: 'Soft' },
        ui: { reply_language: 'zh' },
      };
      const project = '<project_instructions>Keep the local contract.</project_instructions>';
      const skills = '<skills>Use the selected workflow.</skills>';
      const memory = '<relevant_memory>Stable fixture memory.</relevant_memory>';
      const command = resolveShellContext(config, { platform, cwd: process.cwd() });
      const prompt = await composeSystemPrompt({
        shellRulesPrompt: buildDefaultSystemPrompt(config, { platform }),
        config,
        soulContext: mode === 'coding' ? 'coding' : 'daily',
        projectInstructionsSnippet: project,
        skillsPrompt: skills,
        extraPrompts: [buildExecutionModePromptBlock(mode, command.commandPlatform, command.shell)],
        memorySnapshot: memory,
      });
      for (const marker of ['# Tool discipline', '# Natural writing', '[Soul preset:', '[Soul guard]', '[Reply language]', 'Execution Mode:', project, skills, memory]) {
        assert.equal(prompt.split(marker).length - 1, 1, marker);
      }
      assert.ok(prompt.indexOf(project) < prompt.indexOf(skills));
      assert.ok(prompt.indexOf(skills) < prompt.indexOf('Execution Mode:'));
      assert.ok(prompt.indexOf('Execution Mode:') < prompt.indexOf('[Reply language]'));
      assert.ok(prompt.endsWith(memory));
      assert.match(prompt, /Respond in Simplified Chinese/);
      if (command.commandPlatform === 'win32') {
        assert.match(prompt, /PowerShell coding guidelines/);
        assert.match(prompt, /"old_text":/);
      } else {
        assert.match(prompt, /Bash coding guidelines/);
        assert.match(prompt, /"old_string":/);
        assert.doesNotMatch(prompt, /apply_patch|PowerShell coding guidelines/);
      }
      assert.ok(prompt.length < (mode === 'coding' ? 7800 : 7000), `assembled prompt grew to ${prompt.length}`);
      if (mode === 'coding') {
        assert.match(prompt, /Implementation quality:/);
        assert.match(prompt, /coding approach/);
      } else {
        assert.doesNotMatch(prompt, /Implementation quality:|Delegation:/);
        assert.match(prompt, /tone and personality only/);
      }
    });
  }
}

test('Crew composition keeps coordinator restrictions without ordinary coding or daily mode rules', async () => {
  const prompt = await composeSystemPrompt({
    shellRulesPrompt: buildDefaultSystemPrompt({ sandbox: { enabled: false } }),
    config: { soul: { coding: 'Default' } },
    soulContext: 'coding',
    includeMemory: false,
    includeProjectInstructions: false,
    extraPrompts: [buildCrewModePromptBlock({ active: true, base: 'main' })],
  });
  assert.equal(prompt.split('Crew Mode: on').length - 1, 1);
  assert.doesNotMatch(prompt, /Execution Mode:|Implementation quality:|Delegation:/);
  assert.match(prompt, /Do not implement, answer the coding question yourself, or edit the main checkout/);
  assert.match(prompt, /fork_task is not available/);
});

test('composition preserves intentional repeats in supplied project and skill instructions', async () => {
  const instruction = 'Keep this project-specific rule verbatim.';
  const prompt = await composeSystemPrompt({
    shellRulesPrompt: 'BASE',
    includeSoul: false,
    includeMemory: false,
    projectInstructionsSnippet: `<project_instructions>${instruction}</project_instructions>`,
    skillsPrompt: `<skills>${instruction}</skills>`,
  });
  assert.equal(prompt.split(instruction).length - 1, 2);
  assert.doesNotMatch(prompt, /Soul guard|relevant_memory/);
});
