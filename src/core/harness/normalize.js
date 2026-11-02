import crypto from 'node:crypto';

const SENSITIVE_KEYS = new Set(['api_key', 'apikey', 'authorization', 'password', 'secret', 'token', 'content']);
const MAX_STRING = 1200;
const MAX_ITEMS = 20;

function sanitize(value, depth = 0) {
  if (depth > 4) return '[truncated]';
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((item) => sanitize(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, MAX_ITEMS).map(([key, item]) => [
      key,
      SENSITIVE_KEYS.has(key.toLowerCase()) ? '[redacted]' : sanitize(item, depth + 1)
    ]));
  }
  return String(value);
}

export function normalizeDecisionState(state = {}) {
  return sanitize(state);
}

export function stableHash(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

export function normalizeDecisionInput(state = {}, questions = []) {
  const normalizedState = normalizeDecisionState(state);
  const normalizedQuestions = sanitize(questions);
  return {
    state: normalizedState,
    questions: normalizedQuestions,
    inputHash: stableHash(normalizedState),
    optionsHash: stableHash(normalizedQuestions),
  };
}
