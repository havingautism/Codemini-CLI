const DEFAULT_SESSION_TITLE_ZH = '新会话';
const DEFAULT_SESSION_TITLE_EN = 'New session';

const VAGUE_TITLE_USER_RE =
  /^(帮我看看|帮我看下|帮我看一下|看看这个|看一下|修一下这个|fix this|fix it|help me|帮忙看看|hi|hello|你好)[.!！？…\s]*$/iu;

/** Titles that look like the start of an assistant reply, not a topic label. */
const ASSISTANT_REPLY_TITLE_RE =
  /^(?:好的|好呀|好嘞|好的呢|没问题|当然(?:可以|了)?|可以的|行啊?|嗯+|收到(?:了)?|明白(?:了)?|了解(?:了)?|谢谢(?:你)?|ok(?:ay)?|sure|absolutely|of course|no problem|got it|understood|here(?:'s| are| is)|i(?:'d| would)? (?:be happy to|can help)|i(?: can| will|'ll| have|'ve)|we(?: can| will|'ll)|you can|please|let me|我会|我来(?:帮你)?|我可以(?:帮你)?|我已经|我能|这就|马上|以下(?:是|为)|这里(?:是|有)|下面(?:是|为)|接下来|可以这样|很高兴|已为你)/iu;

const GENERIC_ACKNOWLEDGEMENT_RE =
  /^(?:好|好的|好呀|好嘞|没问题|可以|可以的|行|嗯+|收到|明白(?:了)?|了解(?:了)?|ok(?:ay)?|sure|yes|no problem|got it|understood|thanks|thank you)[\s,，:：、.!?！？…]*$/iu;

export const SESSION_TITLE_SYSTEM_PROMPT = [
  'Create a short chat title that names the topic of the user\'s request.',
  'Use the user message as the source of truth; assistant text is only a topic hint when present.',
  'Return a compact topic label / 名词短语, not a sentence and not a conversation summary.',
  'Do not answer the user. Do not write an assistant reply, acknowledgment, or offer to help.',
  'Do not summarize outcomes, steps taken, or what the assistant did.',
  'Use the same language as the user when possible.',
  'No prefixes like "Title:", no quotes, no markdown, no ending punctuation.',
  'Maximum 16 Chinese characters or 6 English words.',
  'Bad: "这是一次关于修复 Web UI 标题生成问题的会话总结"',
  'Good: "Web UI 标题生成"',
  'Bad: "没问题，以下是一些简单注释"',
  'Bad: "当然可以，我可以帮你"',
  'Good: "Plan 工具注释测试"',
  'Bad: "Sure, here are a few comments"',
  'Bad: "Of course, I can help"',
  'Good: "Generate sample comments"',
  'Bad: "This conversation explains how to fix OAuth redirect failures"',
  'Good: "OAuth redirect failure"'
].join(' ');

export function shouldReplaceSessionTitle(title) {
  const value = String(title || '').trim();
  return !value || value === DEFAULT_SESSION_TITLE_ZH || value === DEFAULT_SESSION_TITLE_EN;
}

export function isVagueTitleUserText(userText) {
  const text = String(userText || '').replace(/\s+/g, ' ').trim();
  if (!text) return true;
  if (VAGUE_TITLE_USER_RE.test(text)) return true;
  return [...text].length <= 8;
}

export function looksLikeAssistantReplyTitle(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  if (ASSISTANT_REPLY_TITLE_RE.test(text)) return true;
  if (GENERIC_ACKNOWLEDGEMENT_RE.test(text)) return true;
  // Sentence-like openers with a comma often mean the model started answering.
  if (/^(?:好|行|嗯|ok|sure|yes)[,，]/iu.test(text)) return true;
  // These markers are useful in a reply but almost never belong in a topic label.
  if (/^(?:建议|推荐|答案|解决方案|步骤|说明|解释|总结|结论)\s*[:：]/iu.test(text)) return true;
  if (/^(?:我|我们)(?:会|可以|能|将|已经|已|来|帮你|建议|推荐)/u.test(text)) return true;
  if (/^(?:first|next|finally|to (?:fix|resolve|debug)|you should)\b/iu.test(text)) return true;
  return false;
}

function stripTitleWrappers(value) {
  let text = String(value || '').trim();
  text = text.replace(/^(?:title|标题)\s*[:：]\s*/iu, '');
  text = text.replace(/^["'`「『]+|["'`」』]+$/gu, '');

  const aboutZh = text.match(/^这是一次关于(.+?)的(?:会话|对话)?(?:总结|小结|概述).*$/u);
  if (aboutZh?.[1]) text = aboutZh[1];

  const aboutZhShort = text.match(/^关于(.+?)的(?:会话|对话|讨论|总结|小结).*$/u);
  if (aboutZhShort?.[1]) text = aboutZhShort[1];

  text = text
    .replace(/^(?:this\s+)?(?:conversation|chat|discussion|session)\s+(?:summarizes|is about|about|regarding|explains how to)\s+/iu, '')
    .replace(/^(?:a\s+)?(?:summary|overview)\s+of\s+/iu, '');

  text = text.replace(/(?:问题|会话|对话|总结|小结)$/u, '');
  return text.trim();
}

function truncateTitle(title) {
  if (!title) return '';
  return title.length > 48 ? `${title.slice(0, 45).trimEnd()}...` : title;
}

export function normalizeGeneratedSessionTitle(value, fallback = '') {
  const raw = String(value || '').trim();
  // A title should be one line. Multi-line output is usually a leaked answer,
  // markdown, or a list; falling back is safer than keeping only its first line.
  if (/\r?\n|```|^\s*(?:[-*•]|\d+[.)])\s+/u.test(raw)) {
    return truncateTitle(String(fallback || '').trim());
  }

  const cleaned = stripTitleWrappers(value)
    .replace(/^[\s"'`#：:「『【\[]+|[\s"'`。.!?？！」』】\]]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || looksLikeAssistantReplyTitle(cleaned) || /[。！？!?]\s*\S/u.test(cleaned)) {
    return truncateTitle(String(fallback || '').trim());
  }

  return truncateTitle(cleaned);
}

export function buildSessionTitleInput({ userText, assistantText = '' } = {}) {
  const user = String(userText || '').trim().slice(0, 800);
  const parts = [`User:\n${user}`];
  if (isVagueTitleUserText(user)) {
    const hint = String(assistantText || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
    // Skip reply-like assistant snippets so the model does not copy openers.
    if (hint && !looksLikeAssistantReplyTitle(hint)) {
      parts.push(`Assistant context (topic hint only — extract the topic, do not copy phrasing):\n${hint}`);
    }
  }
  return parts.join('\n\n');
}
