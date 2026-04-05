const SECRET_PATTERNS = [
  /\b(api[_-]?key|token|secret|password|passwd|bearer)\b/i,
  /\b(database_url|aws_secret_access_key|aws_access_key_id|openai_api_key|github_token|github_pat|slack_bot_token)\b\s*[:=]\s*\S+/i,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^/\s:@]+:[^@\s]+@/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[a-z0-9]{20,}\b/i,
  /\bgithub_pat_[a-z0-9_]{20,}\b/i,
  /\bglpat-[a-z0-9_-]{20,}\b/i,
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
