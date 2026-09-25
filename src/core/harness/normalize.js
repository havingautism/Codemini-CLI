import crypto from 'node:crypto';

const SENSITIVE_KEYS = new Set(['api_key', 'apikey', 'authorization', 'password', 'secret', 'token']);
const LOG_SENSITIVE_KEYS = new Set([...SENSITIVE_KEYS, 'content']);
const MAX_STRING = 1200;
const MAX_ITEMS = 20;
const MAX_DEPTH = 4;

function sanitize(value, depth = 0, options = {}) {
  const {
    redactSensitive = false,
    maxString = MAX_STRING,
    maxItems = MAX_ITEMS,
    maxDepth = MAX_DEPTH,
  } = options;
  if (depth > maxDepth) return '[truncated]';
  if (typeof value === 'string') return value.length > maxString ? `${value.slice(0, maxString)}…` : value;
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, maxItems).map((item) => sanitize(item, depth + 1, options));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, maxItems).map(([key, item]) => [
      key,
      (redactSensitive ? LOG_SENSITIVE_KEYS : SENSITIVE_KEYS).has(key.toLowerCase())
        ? '[redacted]'
        : sanitize(item, depth + 1, options)
    ]));
  }
  return String(value);
}

export function normalizeDecisionState(state = {}, options = {}) {
  return sanitize(state, 0, options);
}

export function stableHash(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

export function normalizeDecisionInput(state = {}, questions = [], options = {}) {
  const normalizedState = normalizeDecisionState(state, options);
  const normalizedQuestions = sanitize(questions, 0, options);
  return {
    state: normalizedState,
    questions: normalizedQuestions,
    inputHash: stableHash(normalizedState),
    optionsHash: stableHash(normalizedQuestions),
  };
}
