const SECRET_PATTERNS = [
  /\b(api[_-]?key|token|secret|password|passwd|bearer)\b/i,
  /\bsk-[a-z0-9]{8,}\b/i,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/i
];

export function normalizeMemoryText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function isSensitiveMemoryContent(value) {
  const text = normalizeMemoryText(value);
  if (!text) return false;
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

export function assertSafeMemoryContent(value) {
  if (isSensitiveMemoryContent(value)) {
    throw new Error('Refusing to store sensitive or secret-like memory content');
  }
}

export function summarizeMemoryContent(value, maxChars = 72) {
  const text = normalizeMemoryText(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}
