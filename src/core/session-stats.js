// 会话统计累加器：记录按类型的工具调用计数与有界错误摘要。
// 累加器是纯函数，挂载在会话对象上——随会话存活（上下文压缩后仍保留）、随会话切换重置。
// 错误记录分两层：errors 为常驻摘要（类型 + ≤100 字消息，进入快照）；errorDetails 为完整详情（按需读取，绝不进快照）。

const MAX_ERROR_SUMMARY_ITEMS = 3;
const MAX_ERROR_MESSAGE_CHARS = 100;
const MAX_ERROR_DETAIL_CHARS = 2000;

export function createSessionStats() {
  return {
    toolCalls: {},
    errors: [],
    errorDetails: [],
    errorCount: 0,
    updatedAt: null,
  };
}

export function truncateErrorMessage(message) {
  const text = String(message ?? '').trim();
  if (text.length <= MAX_ERROR_MESSAGE_CHARS) return text;
  return `${text.slice(0, MAX_ERROR_MESSAGE_CHARS - 1)}…`;
}

// 完整详情按需加载，但仍需有界，避免长堆栈无限常驻会话。
export function truncateErrorDetail(message) {
  const text = String(message ?? '').trim();
  if (text.length <= MAX_ERROR_DETAIL_CHARS) return text;
  return `${text.slice(0, MAX_ERROR_DETAIL_CHARS - 1)}…`;
}

export function recordToolEvent(stats, event) {
  const base = stats && typeof stats === 'object' ? stats : createSessionStats();
  const next = {
    toolCalls: { ...(base.toolCalls || {}) },
    errors: Array.isArray(base.errors) ? base.errors.slice() : [],
    errorDetails: Array.isArray(base.errorDetails) ? base.errorDetails.slice() : [],
    errorCount: Number(base.errorCount || 0),
    updatedAt: base.updatedAt || null,
  };
  const type = event?.type;
  const name = String(event?.name || '').trim();
  if (name) {
    next.toolCalls[name] = (next.toolCalls[name] || 0) + 1;
  }
  if (type === 'tool:error' || type === 'tool:blocked') {
    const category = type === 'tool:blocked' ? 'blocked' : 'error';
    const at = new Date().toISOString();
    next.errors.push({
      tool: name || '(unknown)',
      category,
      message: truncateErrorMessage(event?.summary),
      at,
    });
    next.errorDetails.push({
      tool: name || '(unknown)',
      category,
      message: truncateErrorDetail(event?.detail ?? event?.summary),
      at,
    });
    next.errorCount += 1;
    if (next.errors.length > MAX_ERROR_SUMMARY_ITEMS) {
      next.errors = next.errors.slice(-MAX_ERROR_SUMMARY_ITEMS);
    }
    if (next.errorDetails.length > MAX_ERROR_SUMMARY_ITEMS) {
      next.errorDetails = next.errorDetails.slice(-MAX_ERROR_SUMMARY_ITEMS);
    }
  }
  next.updatedAt = new Date().toISOString();
  return next;
}

export function getSessionStats(session) {
  const stats = session?.stats;
  if (stats && typeof stats === 'object') return stats;
  return createSessionStats();
}

// 完整错误详情：仅按需读取，随会话存活、随会话切换重置。
export function getSessionErrorDetails(session) {
  const stats = getSessionStats(session);
  return Array.isArray(stats.errorDetails) ? stats.errorDetails : [];
}

// 清空本会话错误（摘要与完整详情一并清空），返回新的统计对象。
export function clearSessionErrors(stats) {
  const base = stats && typeof stats === 'object' ? stats : createSessionStats();
  return {
    ...base,
    errors: [],
    errorDetails: [],
    errorCount: 0,
    updatedAt: base.updatedAt || null,
  };
}
