import { estimateMessagesTokens } from './context-compact.js';

export function estimateMemoryTokens(text, role = 'system') {
  const value = String(text || '');
  if (!value) return 0;
  return Math.max(0, estimateMessagesTokens([{ role, content: value }]) - 6);
}

export function normalizeMemoryTokenBudget(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.max(1, Math.floor(Number(fallback) || 1));
  return Math.max(1, Math.floor(parsed));
}

/**
 * Keeps whole memory records in priority order. render() must return the final
 * wrapper for a candidate list, so XML/header overhead is part of the budget.
 */
export function fitMemoryItemsToTokenBudget(items = [], { maxTokens, render } = {}) {
  const source = Array.isArray(items) ? items : [];
  if (typeof render !== 'function' || source.length === 0) return [];
  const budget = normalizeMemoryTokenBudget(maxTokens, Number.MAX_SAFE_INTEGER);
  const selected = [];
  for (const item of source) {
    const candidate = [...selected, item];
    if (estimateMemoryTokens(render(candidate)) <= budget) selected.push(item);
  }
  return selected;
}
