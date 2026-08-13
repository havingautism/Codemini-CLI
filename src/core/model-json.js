import { jsonrepair } from 'jsonrepair';

function candidates(raw) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const starts = [raw.indexOf('{'), raw.indexOf('[')].filter((index) => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  const end = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
  return [...new Set([fenced, start >= 0 && end > start ? raw.slice(start, end + 1) : '', raw].filter(Boolean))];
}

export function parseModelJson(value) {
  if (value && typeof value === 'object') return value;
  const raw = String(value || '').trim();
  if (!raw) return null;
  for (const candidate of candidates(raw)) {
    try {
      return JSON.parse(candidate);
    } catch {}
    try {
      return JSON.parse(jsonrepair(candidate));
    } catch {}
  }
  return null;
}

export function parseModelJsonObject(value) {
  const parsed = parseModelJson(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}
