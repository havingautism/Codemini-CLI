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
  includeSoul = true,
  soulContext,
} = {}) {
  const [shellAndSoul, memoryPrompt, projectInstructionsPrompt, resolvedSkillsPrompt] = await Promise.all([
    includeSoul
      ? buildSystemPromptWithSoul(shellRulesPrompt, config, { context: soulContext })
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
  const body = joinPromptParts([
    shellAndSoul,
    projectInstructionsPrompt,
    resolvedSkillsPrompt,
    projectContextSnippet,
    projectContextSnippet ? projectContextGuidance : '',
    ...extraPrompts
  ]);
  const basePrompt = buildSystemPromptWithReplyLanguage(body, config);
  // <relevant_memory> is the most volatile section (save_memory / Dream /
  // session review can change it mid-session), so it sits BELOW the reply
  // language directive, at the very end of the system prompt. That keeps the
  // stable prefix (skeleton + env + instructions + skills + reply language)
  // byte-identical and cacheable when memory changes.
  if (!memoryPrompt) return basePrompt;
  return [basePrompt, memoryPrompt].filter(Boolean).join('\n\n');
}
