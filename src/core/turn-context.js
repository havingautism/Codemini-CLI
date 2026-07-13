import { formatLocalDate } from './command-loader.js';
import { getSearchTurnContextLine } from './provider/search-tool-registry.js';

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
  userText = ''
} = {}) {
  const prefix = String(turnContextPrefix || '').trim();
  const snippet = String(projectContextSnippet || '').trim();
  const guidance = String(projectContextGuidance || '').trim();
  const request = String(userText || '').trim();
  const hasContext = Boolean(prefix || snippet);

  const parts = [
    prefix,
    snippet,
    snippet && guidance ? guidance : '',
    request
      ? (hasContext ? `User request:\n${request}` : request)
      : ''
  ].filter(Boolean);

  return parts.join('\n\n');
}
