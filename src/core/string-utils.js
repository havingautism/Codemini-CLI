/**
 * 共享字符串/路径工具函数。
 * 统一 trimInline、路径标准化、escapeRegex 等多处重复实现。
 */

/**
 * 将字符串截断到指定长度，超出时添加省略号。
 * 会先将空白折叠为单个空格再截断。
 */
export function trimInline(value, maxLen = 72) {
  const s = String(value || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 3)}...`;
}

/**
 * 将路径中的反斜杠替换为正斜杠，并去掉开头的 "./" 前缀。
 * 用于统一 Windows / Unix 路径格式。
 */
export function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\/+/, '');
}

/**
 * 将路径标准化为相对路径格式：反斜杠→正斜杠，去掉 "./" 和开头的 "/"。
 */
export function normalizeRelativePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
}

/**
 * 转义正则表达式中的特殊字符。
 */
export function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
