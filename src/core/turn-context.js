import { formatLocalDate } from './command-loader.js';

export function buildTurnContextPrefix(config = {}, date = new Date()) {
  const today = formatLocalDate(date);
  const en = String(config?.ui?.reply_language || '').toLowerCase() === 'en';
  if (en) {
    return [
      '<runtime>',
      `Today's date (local): ${today}`,
      'When using web_search or judging news, releases, and other time-sensitive facts, treat this as the current date unless the user says otherwise.',
      '</runtime>'
    ].join('\n');
  }
  return [
    '<runtime>',
    `当前日期（本地）：${today}`,
    '使用 web_search 或判断新闻、版本发布等时效性信息时，除非用户另有说明，请以此为准。',
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
