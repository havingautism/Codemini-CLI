export function normalizeReplyLanguage(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'zh';
  if (['en', 'en-us', 'en_us', 'english'].includes(raw)) return 'en';
  if (['zh', 'zh-cn', 'zh_cn', 'cn', 'chinese', '中文', '简体中文'].includes(raw)) return 'zh';
  return 'zh';
}

export function getReplyLanguage(config = {}) {
  if (typeof config === 'string') return normalizeReplyLanguage(config);
  return normalizeReplyLanguage(config?.ui?.reply_language);
}

export function getReplyLanguageName(config = {}) {
  return getReplyLanguage(config) === 'en' ? 'English' : 'Simplified Chinese';
}

/** Shared rule for durable / user-facing generated prose across chat + side LLM jobs. */
export function buildGeneratedProseLanguageRule(config = {}) {
  const language = getReplyLanguageName(config);
  return (
    `Write generated durable prose (memory content/summary, documentation, user-facing labels, ` +
    `skill draft text, and code comments) in ${language} unless the user explicitly asks for a different language. ` +
    'Keep identifiers, file paths, commands, API routes, enum keys, and JSON field names unchanged.'
  );
}

/**
 * Compact rule for standalone LLM calls that emit JSON with human-readable fields.
 * Enum keys / ids / paths stay English; content/summary/description follow reply language.
 */
export function buildStructuredOutputLanguageRule(config = {}, {
  fields = 'content and summary'
} = {}) {
  const language = getReplyLanguageName(config);
  return (
    `Language: write ${fields} in ${language}. ` +
    'Keep enum values, ids, paths, and JSON keys in English exactly as specified.'
  );
}

export function appendStructuredOutputLanguageRule(basePrompt, config = {}, options = {}) {
  const base = String(basePrompt || '').trim();
  const rule = buildStructuredOutputLanguageRule(config, options);
  if (!base) return rule;
  if (base.includes(rule) || /Language:\s*write .+ in (?:English|Simplified Chinese)\./.test(base)) {
    return base;
  }
  return `${base}\n\n${rule}`;
}

export function buildSystemPromptWithReplyLanguage(baseSystemPrompt, config = {}) {
  const language = getReplyLanguageName(config);
  const directive = [
    '[Reply language]',
    `Respond in ${language}.`,
    buildGeneratedProseLanguageRule(config)
  ].join('\n');

  // Idempotent: strip any trailing directive first so re-applying never
  // duplicates the block (the directive is always the last section).
  const base = stripReplyLanguageDirective(baseSystemPrompt);
  return `${base}\n\n${directive}`.trim();
}

export function stripReplyLanguageDirective(systemPrompt) {
  const text = String(systemPrompt || '');
  // Strip only a "[Reply language]" directive BLOCK (exactly three lines:
  // marker, "Respond in <lang>.", prose rule). Content BELOW the directive —
  // e.g. the volatile <relevant_memory> section that now lives at the very end
  // of the system prompt — must survive. Anchored to the LAST matching block
  // so earlier literal "[Reply language]" text is left untouched.
  const matches = [...text.matchAll(
    /\n{0,2}\[Reply language\]\nRespond in (?:English|Simplified Chinese)\.\n[^\n]*(?=\n|$)/g,
  )];
  if (matches.length === 0) return text.trim();
  const last = matches[matches.length - 1];
  return `${text.slice(0, last.index)}${text.slice(last.index + last[0].length)}`.trim();
}
