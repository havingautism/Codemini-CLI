export function parseTowerWakeHeadline(wakeText = '') {
  const lines = String(wakeText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const headline = lines.find((line) => !line.startsWith('<') && !line.startsWith('</'));
  return headline || 'Tower notification';
}

export function parseTowerReviewCompletedWake(wakeText = '') {
  const headline = parseTowerWakeHeadline(wakeText);
  const match = String(headline || '').match(/Tower review of "([^"]+)" finished/i);
  return match ? String(match[1] || '').trim() : '';
}
