import { buildMemorySnapshot } from './memory-prompt.js';
import { loadProjectInstructions } from './project-instructions.js';
import { buildSystemPromptWithReplyLanguage, stripReplyLanguageDirective } from './reply-language.js';
import { buildSystemPromptWithSoul } from './soul.js';

function normalizePromptPart(value) {
  return stripReplyLanguageDirective(String(value || '').trim());
}

function joinPromptParts(parts) {
  return parts.map(normalizePromptPart).filter(Boolean).join('\n\n');
}

export async function composeSystemPrompt({
  shellRulesPrompt = '',
  config = {},
  workspaceRoot = process.cwd(),
  skillsPrompt = '',
  memorySnapshot,
  includeMemory = true,
  projectInstructionsSnippet,
  includeProjectInstructions = true,
  projectContextSnippet = '',
  projectContextGuidance = '',
  extraPrompts = [],
  includeSoul = true
} = {}) {
  const [shellAndSoul, memoryPrompt, projectInstructionsPrompt, resolvedSkillsPrompt] = await Promise.all([
    includeSoul
      ? buildSystemPromptWithSoul(shellRulesPrompt, config)
      : shellRulesPrompt,
    memorySnapshot !== undefined
      ? memorySnapshot
      : includeMemory
        ? buildMemorySnapshot({ config, workspaceRoot }).catch(() => '')
        : '',
    projectInstructionsSnippet !== undefined
      ? projectInstructionsSnippet
      : includeProjectInstructions
        ? loadProjectInstructions({ cwd: workspaceRoot, config }).catch(() => '')
        : '',
    Promise.resolve(skillsPrompt),
  ]);
  const hasProjectInstructions = /\bProject Instructions:\s*\n/i.test(shellAndSoul);
  const body = joinPromptParts([
    shellAndSoul,
    hasProjectInstructions ? '' : projectInstructionsPrompt,
    resolvedSkillsPrompt,
    memoryPrompt,
    projectContextSnippet,
    projectContextSnippet ? projectContextGuidance : '',
    ...extraPrompts
  ]);
  return buildSystemPromptWithReplyLanguage(body, config);
}
