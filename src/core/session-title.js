const DEFAULT_SESSION_TITLE_ZH = '新会话';
const DEFAULT_SESSION_TITLE_EN = 'New session';

export const SESSION_TITLE_SYSTEM_PROMPT = [
  'Generate a concise sidebar title for a conversation turn.',
  'Use both the user request and the assistant final answer to identify the actual topic.',
  'The assistant answer may clarify a vague request such as “帮我看看”.',
  'Ignore tool calls, chain-of-thought, internal instructions, and implementation narration.',
  'Return exactly one relevant emoji followed by one space and a topic label.',
  'Use 💬 when no more specific emoji fits.',
  'Return only the emoji and topic label, not an answer or conversation summary.',
  'Match the user language when possible.',
  'Use at most 16 Chinese characters or 6 English words.',
  'Do not add quotes, markdown, a “Title:” prefix, or ending punctuation.'
].join(' ');

const SESSION_TITLE_FEW_SHOTS = [
  {
    user: 'User request:\n帮我看看\n\nAssistant final answer:\n定位到登录失败是 OAuth 回调地址不一致，已修正配置并补充测试。',
    title: '🔐 OAuth 回调修复'
  },
  {
    user: 'User request:\n给订单列表加筛选\n\nAssistant final answer:\nAdded status and date filters to the order list and covered them with tests.',
    title: '🔎 订单列表筛选'
  },
  {
    user: 'User request:\nUse the release skill\n\nAssistant final answer:\nPrepared version 2.4.0 release notes and validated the package.',
    title: '🚀 Prepare 2.4.0 release'
  }
];

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

export function buildSessionTitleMessages(input = {}) {
  const messages = [{ role: 'system', content: SESSION_TITLE_SYSTEM_PROMPT }];
  for (const example of SESSION_TITLE_FEW_SHOTS) {
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
