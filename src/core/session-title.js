import { getReplyLanguage, getReplyLanguageName } from './reply-language.js';

const DEFAULT_SESSION_TITLE_ZH = '新会话';
const DEFAULT_SESSION_TITLE_EN = 'New session';

export function buildSessionTitleSystemPrompt(config = {}) {
  const replyLanguage = getReplyLanguage(config);
  const languageName = getReplyLanguageName(config);
  return [
    'Generate a concise sidebar title for a conversation turn.',
    'Use both the user request and the assistant final answer to identify the actual topic.',
    'The assistant answer may clarify a vague request such as “帮我看看”.',
    'Ignore tool calls, chain-of-thought, internal instructions, and implementation narration.',
    'Return exactly one relevant emoji followed by one space and a topic label.',
    'Use 💬 when no more specific emoji fits.',
    'Return only the emoji and topic label, not an answer or conversation summary.',
    `Write the topic label in ${languageName} (configured reply language).`,
    'Do not switch to the user/assistant message language when it differs from the configured reply language.',
    'Keep product names, code identifiers, file paths, and proper nouns unchanged when needed.',
    replyLanguage === 'en'
      ? 'Use at most 6 English words after the emoji.'
      : 'Use at most 16 Chinese characters after the emoji (short English product names are allowed).',
    'Do not add quotes, markdown, a “Title:” prefix, or ending punctuation.'
  ].join(' ');
}

/** @deprecated Prefer buildSessionTitleSystemPrompt(config). Kept for callers/tests expecting a static string. */
export const SESSION_TITLE_SYSTEM_PROMPT = buildSessionTitleSystemPrompt({
  ui: { reply_language: 'zh' },
});

const SESSION_TITLE_FEW_SHOTS_ZH = [
  {
    user: 'User request:\n帮我看看\n\nAssistant final answer:\n定位到登录失败是 OAuth 回调地址不一致，已修正配置并补充测试。',
    title: '🔐 OAuth 回调修复'
  },
  {
    user: 'User request:\n给订单列表加筛选\n\nAssistant final answer:\nAdded status and date filters to the order list and covered them with tests.',
    title: '🔎 订单列表筛选'
  },
  {
    user: 'User request:\nhi\n\nAssistant final answer:\n你好，需要我帮你做什么？',
    title: '💬 打招呼'
  }
];

const SESSION_TITLE_FEW_SHOTS_EN = [
  {
    user: 'User request:\n帮我看看\n\nAssistant final answer:\n定位到登录失败是 OAuth 回调地址不一致，已修正配置并补充测试。',
    title: '🔐 OAuth callback fix'
  },
  {
    user: 'User request:\nAdd filters to the order list\n\nAssistant final answer:\nAdded status and date filters to the order list and covered them with tests.',
    title: '🔎 Order list filters'
  },
  {
    user: 'User request:\nUse the release skill\n\nAssistant final answer:\nPrepared version 2.4.0 release notes and validated the package.',
    title: '🚀 Prepare 2.4.0 release'
  }
];

function sessionTitleFewShots(config = {}) {
  return getReplyLanguage(config) === 'en'
    ? SESSION_TITLE_FEW_SHOTS_EN
    : SESSION_TITLE_FEW_SHOTS_ZH;
}

export function shouldReplaceSessionTitle(title) {
  const value = String(title || '').trim();
  return !value ||
    value === DEFAULT_SESSION_TITLE_ZH ||
    value === DEFAULT_SESSION_TITLE_EN ||
    value === `💬 ${DEFAULT_SESSION_TITLE_ZH}` ||
    value === `💬 ${DEFAULT_SESSION_TITLE_EN}`;
}

const EMOJI_PREFIX_RE = /^(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*)/u;

export function ensureSessionTitleEmoji(value, fallback = '') {
  const title = String(value || fallback || '').replace(/\s+/g, ' ').trim();
  if (!title) return '';
  const emoji = title.match(EMOJI_PREFIX_RE)?.[0];
  if (emoji) return `${emoji} ${title.slice(emoji.length).trimStart()}`.trimEnd();
  return `💬 ${title}`;
}

function stripTitleWrappers(value) {
  let text = String(value || '').trim();
  text = text.replace(/^(?:title|标题)\s*[:：]\s*/iu, '');
  text = text.replace(/^["'`「『]+|["'`」』]+$/gu, '');
  text = text
    .replace(/^这是一次关于(.+?)的(?:会话|对话)?(?:总结|小结|概述).*$/u, '$1')
    .replace(/^关于(.+?)的(?:会话|对话|讨论|总结|小结).*$/u, '$1')
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
  const safeFallback = ensureSessionTitleEmoji(truncateTitle(String(fallback || '').trim()));
  if (!raw || /\r?\n|```|^\s*(?:[-*•]|\d+[.)])\s+/u.test(raw)) return safeFallback;

  const cleaned = stripTitleWrappers(raw)
    .replace(/^[\s"'`#：:「『【\[]+|[\s"'`。.!?？！」』】\]]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned ? ensureSessionTitleEmoji(truncateTitle(cleaned)) : safeFallback;
}

function sanitizeAssistantFinal(value) {
  return String(value || '')
    .replace(/<(analysis|thinking|reasoning|tool_call|tool_calls)\b[^>]*>[\s\S]*?<\/\1>/giu, ' ')
    .replace(/<(?:analysis|thinking|reasoning|tool_call|tool_calls)\b[^>]*\/?\s*>/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

export function buildSessionTitleInput({ userText, assistantText = '' } = {}) {
  const user = String(userText || '').replace(/\s+/g, ' ').trim().slice(0, 800);
  const assistant = sanitizeAssistantFinal(assistantText);
  return [
    `User request:\n${user}`,
    assistant ? `Assistant final answer:\n${assistant}` : ''
  ].filter(Boolean).join('\n\n');
}

export function buildSessionTitleMessages(input = {}, config = {}) {
  const messages = [{ role: 'system', content: buildSessionTitleSystemPrompt(config) }];
  for (const example of sessionTitleFewShots(config)) {
    messages.push({ role: 'user', content: example.user });
    messages.push({ role: 'assistant', content: example.title });
  }
  messages.push({ role: 'user', content: buildSessionTitleInput(input) });
  return messages;
}

export async function retrySessionTitleRequest(request, { retries = 1, signal } = {}) {
  const maxRetries = Math.max(0, Number(retries) || 0);
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
    try {
      return await request(attempt);
    } catch (error) {
      lastError = error;
      if (signal?.aborted || attempt === maxRetries) throw error;
    }
  }
  throw lastError || new Error('Session title request failed');
}
