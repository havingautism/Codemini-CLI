export function parseCrewWakeHeadline(wakeText = '') {
  const lines = String(wakeText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const headline = lines.find((line) => !line.startsWith('<') && !line.startsWith('</'));
  return headline || 'Crew notification';
}

export function parseCrewReviewCompletedWake(wakeText = '') {
  const headline = parseCrewWakeHeadline(wakeText);
  const match = String(headline || '').match(/(?:Crew|Crew) review of "([^"]+)" finished/i);
  return match ? String(match[1] || '').trim() : '';
}
