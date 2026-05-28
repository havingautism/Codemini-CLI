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

function normalizePathValueWithInlineRange(value) {
  const text = String(value || '').trim();
  if (!text) return { path: '', inlineRange: null };
  const inlineRange = parseInlineRangePath(text);
  return {
    path: normalizePath(inlineRange?.path || text),
    inlineRange
  };
}

function normalizeBooleanValue(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return undefined;
  if (['true', '1', 'yes', 'y', 'on'].includes(text)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(text)) return false;
  return Boolean(value);
}

export function normalizeReadArgs(rawArgs) {
  const source =
    rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
      ? { ...rawArgs }
      : { path: typeof rawArgs === 'string' ? rawArgs : '' };

  const normalized = { ...source };
  const aliasPath = source.path || source.file_path || source.file || source.target || '';
  const normalizedPath = normalizePathValueWithInlineRange(aliasPath);
  if (normalizedPath.path) normalized.path = normalizedPath.path;

  if (!Number.isFinite(Number(normalized.start_line)) && Number.isFinite(Number(source.offset))) {
    normalized.start_line = Number(source.offset);
  }

  if (!Number.isFinite(Number(normalized.end_line)) && Number.isFinite(Number(source.limit))) {
    const startLine = Number(normalized.start_line);
    const limit = Number(source.limit);
    if (startLine > 0 && limit > 0) {
      normalized.end_line = startLine + limit - 1;
    }
  }

  const inlineRange = normalizedPath.inlineRange || parseInlineRangePath(normalized.path);
  if (inlineRange) {
    normalized.path = normalizePath(inlineRange.path);
    if (!Number.isFinite(Number(normalized.start_line))) normalized.start_line = inlineRange.start_line;
    if (!Number.isFinite(Number(normalized.end_line))) normalized.end_line = inlineRange.end_line;
  }

  return normalized;
}

export function normalizePathArgs(rawArgs, aliases = []) {
  const source =
    rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
      ? { ...rawArgs }
      : { path: typeof rawArgs === 'string' ? rawArgs : '' };
  const normalized = { ...source };
  const keys = ['path', ...aliases];
  for (const key of keys) {
    const value = normalizeFilePathValue(source?.[key] || '', { stripInlineRange: true });
    if (value) {
      normalized.path = value;
      break;
    }
  }
  return normalized;
}

export function normalizePatternArgs(rawArgs, aliases = [], defaultPathAliases = []) {
  const source =
    rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
      ? { ...rawArgs }
      : { pattern: typeof rawArgs === 'string' ? rawArgs : '' };
  const normalized = { ...source };
  for (const key of ['pattern', ...aliases]) {
    const value = String(source?.[key] || '').trim();
    if (value) {
      normalized.pattern = value;
      break;
    }
  }
  for (const key of ['path', ...defaultPathAliases]) {
    const value = normalizeFilePathValue(source?.[key] || '', { stripInlineRange: true });
    if (value) {
      normalized.path = value;
      break;
    }
  }
  return normalized;
}

export function normalizeWriteArgs(rawArgs) {
  const source =
    rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
      ? { ...rawArgs }
      : { path: typeof rawArgs === 'string' ? rawArgs : '' };
  const normalized = { ...source };
  const filePath = normalizeFilePathValue(source.path || source.file_path || source.file || '', { stripInlineRange: true });
  if (filePath) normalized.path = filePath;
  const append = normalizeBooleanValue(source.append);
  const fullFileRewrite = normalizeBooleanValue(source.full_file_rewrite);
  if (append !== undefined) normalized.append = append;
  if (fullFileRewrite !== undefined) normalized.full_file_rewrite = fullFileRewrite;
  if (normalized.content == null) {
    if (source.text != null) normalized.content = source.text;
    if (source.new_content != null) normalized.content = source.new_content;
  }
  return normalized;
}

export function normalizeWebFetchArgs(rawArgs) {
  const normalized = normalizePathArgs(rawArgs, ['url', 'href', 'link', 'target']);
  const url = String(normalized.url || normalized.path || '').trim();
  return { ...normalized, url };
}

export function normalizeWebSearchArgs(rawArgs) {
  const normalized = normalizePatternArgs(rawArgs, ['query', 'q', 'keyword']);
  const query = String(normalized.query || normalized.pattern || '').trim();
  return { ...normalized, query };
}

function buildDeleteApprovalDetails(source, rawPath) {
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

export function normalizeToolArguments(toolName, args, rawArguments) {
  const rawText = typeof rawArguments === 'string' ? rawArguments.trim() : '';
  const primitive =
    args == null || Array.isArray(args) || typeof args !== 'object'
      ? args
      : null;
  const source =
    args && typeof args === 'object' && !Array.isArray(args)
      ? { ...args }
      : {};

  if (primitive != null && typeof primitive !== 'object') {
    source._raw = rawText || String(primitive);
  } else if (!source._raw && rawText && source._invalid_json) {
    source._raw = rawText;
  }

  const stringValue =
    typeof primitive === 'string'
      ? primitive.trim()
      : String(source._raw || '').trim();

  if (toolName === 'read') return normalizeReadArgs({ ...source, ...(stringValue && !source.path ? { path: stringValue } : {}) });
  if (toolName === 'list') return normalizePathArgs({ ...source, ...(stringValue && !source.path ? { path: stringValue } : {}) }, ['dir', 'directory', 'file_path', 'file', 'target']);
  if (toolName === 'glob') return normalizePatternArgs({ ...source, ...(stringValue && !source.pattern ? { pattern: stringValue } : {}) }, ['glob', 'query'], ['directory', 'dir', 'cwd', 'file_path', 'file']);
  if (toolName === 'grep') return normalizePatternArgs({ ...source, ...(stringValue && !source.pattern ? { pattern: stringValue } : {}) }, ['query', 'symbol', 'q'], ['directory', 'dir', 'cwd', 'file_path', 'file']);
  if (toolName === 'create') return normalizeWriteArgs({ ...source, ...(stringValue && !source.path ? { path: stringValue } : {}) });

  if (toolName === 'edit') {
    const rawPathValue = source.path || source.file || source.file_path || stringValue || '';
    const inlineRange = parseInlineRangePath(rawPathValue);
    const value = normalizeFilePathValue(rawPathValue, { stripInlineRange: true });
    if (value && !source.path) source.path = value;
    if (value && source.path) source.path = value;
    if (inlineRange) {
      if (!Number.isFinite(Number(source.start_line))) source.start_line = inlineRange.start_line;
      if (!Number.isFinite(Number(source.end_line))) source.end_line = inlineRange.end_line;
    }
    if (source.old_text == null && source.old_string != null) source.old_text = source.old_string;
    if (source.new_text == null && source.new_string != null) source.new_text = source.new_string;
    if (source.new_text == null && source.content != null && source.old_text != null) source.new_text = source.content;
    const replaceAll = normalizeBooleanValue(source.replace_all ?? source.replaceAll);
    if (replaceAll !== undefined) source.replace_all = replaceAll;
    return source;
  }

  if (toolName === 'delete') {
    const normalized = normalizePathArgs(
      { ...source, ...(stringValue && !source.path ? { path: stringValue } : {}) },
      ['file_path', 'file', 'target', 'directory', 'dir']
    );
    const approval = buildDeleteApprovalDetails(normalized, normalized.path);
    if (approval) normalized.approval = approval;
    return normalized;
  }

  return source;
}
