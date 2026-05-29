import path from 'node:path';
import { normalizePath } from './string-utils.js';

export function parseInlineRangePath(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const match = text.match(/^(.*?):(\d+)(?:-(\d+))?$/);
  if (!match) return null;
  const [, maybePath, startRaw, endRaw] = match;
  if (!maybePath || /^(?:[A-Za-z])$/.test(maybePath)) return null;
  const startLine = Number(startRaw);
  const endLine = Number(endRaw || startRaw);
  if (!Number.isFinite(startLine) || startLine <= 0) return null;
  if (!Number.isFinite(endLine) || endLine < startLine) return null;
  return {
    path: maybePath,
    start_line: startLine,
    end_line: endLine
  };
}

export function normalizeFilePathValue(value, { stripInlineRange = false } = {}) {
  const text = String(value || '').trim();
  if (!text) return '';
  const inlineRange = stripInlineRange ? parseInlineRangePath(text) : null;
  return normalizePath(inlineRange?.path || text);
}

export function normalizePathValueWithInlineRange(value) {
  const text = String(value || '').trim();
  if (!text) return { path: '', inlineRange: null };
  const inlineRange = parseInlineRangePath(text);
  return {
    path: normalizePath(inlineRange?.path || text),
    inlineRange
  };
}

export function normalizeBooleanValue(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return undefined;
  if (['true', '1', 'yes', 'y', 'on'].includes(text)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(text)) return false;
  return Boolean(value);
}

export function coerceToolRecord(rawArgs, fallbackKey) {
  if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
    return { ...rawArgs };
  }
  if (typeof rawArgs === 'string') {
    return { [fallbackKey]: rawArgs };
  }
  return { [fallbackKey]: '' };
}

export function firstAliasPath(source, aliases = []) {
  for (const key of ['path', ...aliases]) {
    const value = normalizeFilePathValue(source?.[key] || '', { stripInlineRange: true });
    if (value) return value;
  }
  return '';
}

export function firstAliasString(source, keys, fallback = '') {
  for (const key of keys) {
    const value = String(source?.[key] || '').trim();
    if (value) return value;
  }
  return fallback;
}

export function buildDeleteApprovalDetails(source, rawPath) {
  const existing =
    source?.approval && typeof source.approval === 'object' && !Array.isArray(source.approval)
      ? source.approval
      : {};
  const approvalPath = String(existing.path || rawPath || '').trim();
  const approvalName = String(existing.name || (approvalPath ? path.basename(approvalPath) : '') || '').trim();
  const approvalType = String(existing.type || '').trim();

  const approval = {};
  if (approvalPath) approval.path = approvalPath;
  if (approvalName) approval.name = approvalName;
  if (approvalType) approval.type = approvalType;
  return Object.keys(approval).length > 0 ? approval : undefined;
}
