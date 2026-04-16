export function isBlankSystemMessage(message) {
  if (!message || message.label !== 'system') return false;
  const text = String(message.text || '').trim();
  const hasSegments = Array.isArray(message.segments) && message.segments.length > 0;
  const hasToolCalls = Array.isArray(message.toolCalls) && message.toolCalls.length > 0;
  return !text && !hasSegments && !hasToolCalls;
}

export function shouldRenderPlainSystemNotice(message, rows) {
  if (!message || message.label !== 'system') return false;
  const visibleRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (visibleRows.length !== 1) return false;
  return !isBlankSystemMessage(message);
}

export function shouldHideMessageBubble(message, rows) {
  const visibleRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (visibleRows.length > 0) return false;
  if (!message) return true;
  if (isBlankSystemMessage(message)) return true;
  return message.label === 'system';
}

export function getInlineStatusText({ busy, copy }) {
  const value = busy ? copy?.stageTags?.running || '' : copy?.generic?.idle || '';
  return `状态：${value}`;
}

export function getAnimatedStatusGlyph(loaderTick) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const index = Math.abs(Number(loaderTick) || 0) % frames.length;
  return frames[index];
}
