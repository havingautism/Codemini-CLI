import { formatLocalDate } from './command-loader.js';
import { getSearchTurnContextLine } from './provider/search-tool-registry.js';
import { getReplyLanguage } from './reply-language.js';

const EXECUTION_MODE_LABELS = {
  zh: { normal: '日常', plan: '编码', crew: '协作组' },
  en: { normal: 'Daily', plan: 'Coding', crew: 'Crew' },
};

function normalizeSwitchMode(mode) {
  const normalized = String(mode || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'crew') return 'crew';
  if (['spec', 'plan', 'code', 'coding'].includes(normalized)) return 'plan';
  if (['normal', 'daily'].includes(normalized)) return 'normal';
  return '';
}

/** One line when the session's last user-turn mode differs from this turn. */
export function buildExecutionModeSwitchNotice(previousMode, nextMode, config = {}) {
  const from = normalizeSwitchMode(previousMode);
  const to = normalizeSwitchMode(nextMode);
  if (!from || !to || from === to) return '';
  const labels = EXECUTION_MODE_LABELS[getReplyLanguage(config) === 'en' ? 'en' : 'zh'];
  if (getReplyLanguage(config) === 'en') {
    return `Execution mode switched from ${labels[from]} to ${labels[to]}.`;
  }
  return `执行模式已从${labels[from]}切换到${labels[to]}。`;
}

export function buildTurnContextPrefix(config = {}, date = new Date()) {
  const today = formatLocalDate(date);
  const en = String(config?.ui?.reply_language || '').toLowerCase() === 'en';
  const searchLine = getSearchTurnContextLine(config, { language: en ? 'en' : 'zh' });
  if (en) {
    return [
      '<runtime>',
      `Today's date (local): ${today}`,
      searchLine,
      '</runtime>'
    ].join('\n');
  }
  return [
    '<runtime>',
    `当前日期（本地）：${today}`,
    searchLine,
    '</runtime>'
  ].join('\n');
}

export function buildTurnUserPrompt({
  turnContextPrefix = '',
  projectContextSnippet = '',
  projectContextGuidance = '',
  turnRoutingContext = '',
  userText = ''
} = {}) {
  const prefix = String(turnContextPrefix || '').trim();
  const snippet = String(projectContextSnippet || '').trim();
  const guidance = String(projectContextGuidance || '').trim();
  const routing = String(turnRoutingContext || '').trim();
  const request = String(userText || '').trim();

  const parts = [
    prefix,
    routing ? `<turn_context>\n${routing}\n</turn_context>` : '',
    snippet
      ? `<project_context>\n${snippet}\n${guidance ? `${guidance}\n` : ''}</project_context>`
      : '',
    request ? `<task>\n${request}\n</task>` : ''
  ].filter(Boolean);

  return parts.join('\n\n');
}
