export function normalizeReplyLanguage(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'zh';
  if (['en', 'en-us', 'en_us', 'english'].includes(raw)) return 'en';
  if (['zh', 'zh-cn', 'zh_cn', 'cn', 'chinese', '中文', '简体中文'].includes(raw)) return 'zh';
  return 'zh';
}

export function buildSystemPromptWithReplyLanguage(baseSystemPrompt, config = {}) {
  const replyLanguage = normalizeReplyLanguage(config?.ui?.reply_language);
  const directive =
    replyLanguage === 'en'
      ? [
          '[Reply language]',
          'Respond in English.',
          'Write generated documentation, user-facing text, and code comments in English unless the user explicitly asks for a different language.'
        ].join('\n')
      : [
          '[Reply language]',
          'Respond in Simplified Chinese.',
          'Write generated documentation, user-facing text, and code comments in Simplified Chinese unless the user explicitly asks for a different language.'
        ].join('\n');

  return `${String(baseSystemPrompt || '').trim()}\n\n${directive}`.trim();
}
