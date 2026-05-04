const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

export function sanitizeAttr(str) {
  return String(str).replace(/[&"']/g, (c) => ESCAPE_MAP[c]);
}
