import path from 'node:path';

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

export function normalizeReadArgs(rawArgs) {
  const source =
    rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
      ? { ...rawArgs }
      : { path: typeof rawArgs === 'string' ? rawArgs : '' };

  const normalized = { ...source };
  const aliasPath = String(source.path || source.file_path || source.file || source.target || '').trim();
  if (aliasPath) normalized.path = aliasPath;

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

  const inlineRange = parseInlineRangePath(normalized.path);
  if (inlineRange) {
    normalized.path = inlineRange.path;
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
    const value = String(source?.[key] || '').trim();
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
    const value = String(source?.[key] || '').trim();
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
  const filePath = String(source.path || source.file_path || source.file || '').trim();
  if (filePath) normalized.path = filePath;
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
  if (toolName === 'list') return normalizePathArgs({ ...source, ...(stringValue && !source.path ? { path: stringValue } : {}) }, ['dir', 'directory']);
  if (toolName === 'glob') return normalizePatternArgs({ ...source, ...(stringValue && !source.pattern ? { pattern: stringValue } : {}) }, ['glob', 'query'], ['directory']);
  if (toolName === 'grep') return normalizePatternArgs({ ...source, ...(stringValue && !source.pattern ? { pattern: stringValue } : {}) }, ['query', 'symbol', 'q'], ['directory', 'dir', 'cwd']);
  if (toolName === 'write') return normalizeWriteArgs({ ...source, ...(stringValue && !source.path ? { path: stringValue } : {}) });

  if (toolName === 'edit') {
    const value = String(source.path || source.file || source.file_path || '').trim();
    if (value && !source.path) source.path = value;
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
