import { z } from 'zod';
import { normalizePath } from './string-utils.js';
import {
  buildDeleteApprovalDetails,
  coerceToolRecord,
  firstAliasPath,
  firstAliasString,
  normalizeBooleanValue,
  normalizeFilePathValue,
  normalizePathValueWithInlineRange,
  parseInlineRangePath
} from './tool-args-helpers.js';

const looseRecord = z.record(z.string(), z.unknown());

function applyReadNormalization(source) {
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

function applyPathAliases(source, aliases = []) {
  const normalized = { ...source };
  const pathValue = firstAliasPath(source, aliases);
  if (pathValue) normalized.path = pathValue;
  return normalized;
}

function applyPatternAliases(source, patternAliases = [], pathAliases = []) {
  const normalized = { ...source };
  const pattern = firstAliasString(source, ['pattern', ...patternAliases]);
  if (pattern) normalized.pattern = pattern;
  const pathValue = firstAliasPath(source, pathAliases);
  if (pathValue) normalized.path = pathValue;
  return normalized;
}

function applyWriteNormalization(source) {
  const normalized = { ...source };
  const filePath = normalizeFilePathValue(source.path || '', {
    stripInlineRange: true
  });
  if (filePath) normalized.path = filePath;
  const overwrite = normalizeBooleanValue(source.overwrite);
  if (overwrite !== undefined) normalized.overwrite = overwrite;
  return normalized;
}

function applyEditNormalization(source) {
  const normalized = { ...source };
  const rawPathValue = source.path || '';
  const inlineRange = parseInlineRangePath(rawPathValue);
  const value = normalizeFilePathValue(rawPathValue, { stripInlineRange: true });
  if (value) normalized.path = value;
  if (inlineRange) {
    if (!Number.isFinite(Number(normalized.start_line))) normalized.start_line = inlineRange.start_line;
    if (!Number.isFinite(Number(normalized.end_line))) normalized.end_line = inlineRange.end_line;
  }
  const replaceAll = normalizeBooleanValue(source.replace_all);
  if (replaceAll !== undefined) normalized.replace_all = replaceAll;
  return normalized;
}

const readArgsSchema = looseRecord.transform(applyReadNormalization);
const listArgsSchema = looseRecord.transform((source) => applyPathAliases(source, ['dir', 'directory', 'file_path', 'file', 'target']));
const globArgsSchema = looseRecord.transform((source) =>
  applyPatternAliases(source, ['glob', 'query'], ['directory', 'dir', 'cwd', 'file_path', 'file'])
);
const grepArgsSchema = looseRecord.transform((source) =>
  applyPatternAliases(source, ['query', 'symbol', 'q'], ['directory', 'dir', 'cwd', 'file_path', 'file'])
);
const searchCodeArgsSchema = looseRecord
  .transform((source) => {
    const normalized = applyPatternAliases(source, ['query', 'q', 'symbol'], ['directory', 'dir', 'cwd', 'file_path', 'file']);
    const query = String(normalized.query || normalized.pattern || '').trim();
    if (query) normalized.query = query;
    if (normalized.intent != null && normalized.mode == null) normalized.mode = normalized.intent;
    if (normalized.lang != null && normalized.language == null) normalized.language = normalized.lang;
    if (normalized.limit != null && normalized.max_results == null) normalized.max_results = normalized.limit;
    return normalized;
  });
const createArgsSchema = looseRecord.transform(applyWriteNormalization);
const writeArgsSchema = looseRecord.transform(applyWriteNormalization);
const editArgsSchema = looseRecord.transform(applyEditNormalization);
const deleteArgsSchema = looseRecord
  .transform((source) => applyPathAliases(source, ['file_path', 'file', 'target', 'directory', 'dir']))
  .transform((normalized) => {
    const approval = buildDeleteApprovalDetails(normalized, normalized.path);
    if (approval) normalized.approval = approval;
    return normalized;
  });
const webFetchArgsSchema = looseRecord
  .transform((source) => applyPathAliases(source, ['url', 'href', 'link', 'target']))
  .transform((normalized) => {
    const url = String(normalized.url || normalized.path || '').trim();
    return { ...normalized, url };
  });
const webSearchArgsSchema = looseRecord
  .transform((source) => applyPatternAliases(source, ['query', 'q', 'keyword']))
  .transform((normalized) => {
    const query = String(normalized.query || normalized.pattern || '').trim();
    return { ...normalized, query };
  });
const applyPatchArgsSchema = looseRecord
  .transform((source) => {
    const normalized = { ...source };
    return normalized;
  });

const TOOL_SCHEMAS = {
  read: readArgsSchema,
  list: listArgsSchema,
  glob: globArgsSchema,
  grep: grepArgsSchema,
  search_code: searchCodeArgsSchema,
  create: createArgsSchema,
  write: writeArgsSchema,
  edit: editArgsSchema,
  apply_patch: applyPatchArgsSchema,
  delete: deleteArgsSchema,
  web_fetch: webFetchArgsSchema,
  web_search: webSearchArgsSchema
};

function prepareToolSource(args, rawArguments) {
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

  return { source, stringValue };
}

export function normalizeReadArgs(rawArgs) {
  return readArgsSchema.parse(coerceToolRecord(rawArgs, 'path'));
}

export function normalizePathArgs(rawArgs, aliases = []) {
  return looseRecord
    .transform((source) => applyPathAliases(source, aliases))
    .parse(coerceToolRecord(rawArgs, 'path'));
}

export function normalizePatternArgs(rawArgs, aliases = [], defaultPathAliases = []) {
  return looseRecord
    .transform((source) => applyPatternAliases(source, aliases, defaultPathAliases))
    .parse(coerceToolRecord(rawArgs, 'pattern'));
}

export function normalizeWriteArgs(rawArgs) {
  return createArgsSchema.parse(coerceToolRecord(rawArgs, 'path'));
}

export function normalizeWebFetchArgs(rawArgs) {
  return webFetchArgsSchema.parse(coerceToolRecord(rawArgs, 'path'));
}

export function normalizeWebSearchArgs(rawArgs) {
  return webSearchArgsSchema.parse(coerceToolRecord(rawArgs, 'pattern'));
}

export function normalizeToolArguments(toolName, args, rawArguments) {
  const { source, stringValue } = prepareToolSource(args, rawArguments);
  const schema = TOOL_SCHEMAS[toolName];
  if (source._invalid_json && ['create', 'write', 'edit', 'apply_patch', 'delete'].includes(toolName)) {
    return {
      _invalid_json: true,
      _raw: source._raw || stringValue,
      _parseError: source._parseError || 'Invalid JSON tool arguments'
    };
  }

  if (toolName === 'read') {
    return schema.parse({
      ...source,
      ...(stringValue && !source.path ? { path: stringValue } : {})
    });
  }
  if (toolName === 'list') {
    return schema.parse({
      ...source,
      ...(stringValue && !source.path ? { path: stringValue } : {})
    });
  }
  if (toolName === 'glob') {
    return schema.parse({
      ...source,
      ...(stringValue && !source.pattern ? { pattern: stringValue } : {})
    });
  }
  if (toolName === 'grep') {
    return schema.parse({
      ...source,
      ...(stringValue && !source.pattern ? { pattern: stringValue } : {})
    });
  }
  if (toolName === 'search_code') {
    return schema.parse({
      ...source,
      ...(stringValue && !source.query && !source.q && !source.pattern ? { query: stringValue } : {})
    });
  }
  if (toolName === 'create' || toolName === 'write') {
    return schema.parse(source);
  }
  if (toolName === 'edit') {
    return schema.parse(source);
  }
  if (toolName === 'delete') {
    return schema.parse({
      ...source,
      ...(stringValue && !source.path ? { path: stringValue } : {})
    });
  }
  if (toolName === 'apply_patch') {
    return schema.parse(source);
  }
  if (toolName === 'web_fetch' || toolName === 'web_search') {
    return schema.parse(source);
  }

  return source;
}
