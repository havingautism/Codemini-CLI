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
  const shellAndSoul = includeSoul
    ? await buildSystemPromptWithSoul(shellRulesPrompt, config)
    : shellRulesPrompt;
  const memoryPrompt = memorySnapshot !== undefined
    ? memorySnapshot
    : includeMemory
      ? await buildMemorySnapshot({ config, workspaceRoot }).catch(() => '')
      : '';
  const projectInstructionsPrompt = projectInstructionsSnippet !== undefined
    ? projectInstructionsSnippet
    : includeProjectInstructions
      ? await loadProjectInstructions({ cwd: workspaceRoot, config }).catch(() => '')
      : '';
  const hasProjectInstructions = /\bProject Instructions:\s*\n/i.test(shellAndSoul);
  const body = joinPromptParts([
    shellAndSoul,
    hasProjectInstructions ? '' : projectInstructionsPrompt,
    skillsPrompt,
    memoryPrompt,
    projectContextSnippet,
    projectContextSnippet ? projectContextGuidance : '',
    ...extraPrompts
  ]);
  return buildSystemPromptWithReplyLanguage(body, config);
}
