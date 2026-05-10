import { buildMemorySnapshot } from './memory-prompt.js';
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
  const body = joinPromptParts([
    shellAndSoul,
    skillsPrompt,
    memoryPrompt,
    projectContextSnippet,
    projectContextSnippet ? projectContextGuidance : '',
    ...extraPrompts
  ]);
  return buildSystemPromptWithReplyLanguage(body, config);
}
