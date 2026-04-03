export function trimText(text, max = 48) {
  const value = String(text || '').trim();
  if (!value) return '';
  return value.length > max ? `${value.slice(0, Math.max(0, max - 3)).trimEnd()}...` : value;
}

export function parseToolDisplayName(name) {
  const raw = String(name || '').trim();
  const match = raw.match(/^([^(]+)\((.*)\)$/);
  return {
    raw,
    base: match ? match[1] : raw,
    target: match ? match[2] : ''
  };
}

export function isEnglishCopy(copy) {
  return String(copy?.roleLabels?.coder || '').trim() === 'CODER' && String(copy?.roleLabels?.you || '').trim() === 'YOU';
}

export function renderLocalizedEntry(entry, copy, context) {
  if (!entry) return '';
  const locale = isEnglishCopy(copy) ? 'en' : 'zh';
  const renderer = entry[locale];
  return typeof renderer === 'function' ? renderer(context) : '';
}

export function getLastToolActivity(msg, statuses = []) {
  const allowed = new Set((Array.isArray(statuses) ? statuses : []).map((status) => String(status)));
  const segments = Array.isArray(msg?.segments) ? msg.segments : [];
  for (let idx = segments.length - 1; idx >= 0; idx -= 1) {
    const segment = segments[idx];
    if (segment?.type !== 'tool' && segment?.type !== 'system_tool') continue;
    if (allowed.size === 0 || allowed.has(String(segment.status || ''))) return segment;
  }
  return null;
}
