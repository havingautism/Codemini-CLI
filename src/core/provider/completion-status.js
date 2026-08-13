/**
 * Shared completion status helpers for provider streams → agent-loop feedback.
 */

export function normalizeFinishReason(value) {
  return String(value || '').trim().toLowerCase();
}

/** True when the model hit an output token/length limit mid-response. */
export function isCompletionTruncated(finishReason) {
  const reason = normalizeFinishReason(finishReason);
  return reason === 'length' || reason === 'max_tokens';
}

/** Heuristic: JSON parse failed in a way that usually means mid-string truncation. */
export function looksLikeTruncatedJson(parseError = '', raw = '') {
  const err = String(parseError || '');
  if (/unterminated string|unexpected end of json|unexpected end of input|unexpected eof/i.test(err)) {
    return true;
  }
  // Syntax errors in an otherwise complete-looking blob are not truncation.
  if (/unexpected token/i.test(err)) return false;
  const text = String(raw || '').trim();
  if (!text) return false;
  if (text.startsWith('{') && !text.endsWith('}')) return true;
  if (text.startsWith('[') && !text.endsWith(']')) return true;
  return false;
}
