/**
 * Gateways that use serde_json reject lone UTF-16 surrogates that
 * JSON.stringify still emits as \\uD800-style escapes ("unexpected end of hex escape").
 */
export function sanitizeUnicodeText(value) {
  const text = String(value ?? '');
  if (typeof text.toWellFormed === 'function') return text.toWellFormed();
  return text.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '\uFFFD'
  );
}

export function stringifyGatewayJson(value) {
  return JSON.stringify(value, (_key, entry) => (
    typeof entry === 'string' ? sanitizeUnicodeText(entry) : entry
  ));
}
