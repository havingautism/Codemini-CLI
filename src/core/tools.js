import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { escapeRegex, normalizePath } from './string-utils.js';
import {
  classifyCommandIntent,
  hasReadyOutput,
  isDangerousCommand,
  isLikelyLongRunningCommand,
  resolveShell,
  runShellCommand,
  terminateChild
} from './shell.js';
import { evaluateCommandPolicy } from './command-policy.js';
import { findEnclosingSymbol, queryAst, readAstNode, resolveAstTarget } from './ast.js';
import { initializeProjectIndex, queryProjectIndex, refreshIndexedFile } from './project-index.js';
import { checkReadDedup } from './agent-loop.js';
import { TOOL_SKIP_DIRS as SKIP_DIRS, TEXT_EXTENSIONS, CODE_WRITE_GUARD_EXTENSIONS, LANGUAGE_FILE_TYPES } from './constants.js';
import { sha256Prefixed as sha256, sha256 as sha256Hash } from './crypto-utils.js';
import { forgetMemory, listMemories, rememberMemory, searchMemories } from './memory-store.js';
import { normalizeTodos } from './todo-state.js';
const BACKGROUND_TASK_RECENT_OUTPUT_LIMIT = 80;
const BACKGROUND_TASK_POLL_MS = 150;
const MAX_AST_ENCLOSING_BYTES = 300_000;
const MAX_AST_ENCLOSING_LINES = 5_000;
const backgroundTaskRegistry = new Map();
let backgroundTaskCounter = 0;
let backgroundTaskLogCursorCounter = 0;

async function realpathIfExists(targetPath) {
  try {
    return await fs.realpath(targetPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function isWithinResolvedRoot(resolvedRoot, candidatePath) {
  const relative = path.relative(resolvedRoot, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function resolveInWorkspace(root, targetPath = '.') {
  const absRoot = path.resolve(root);
  const realRoot = await fs.realpath(absRoot);
  const absTarget = path.resolve(absRoot, targetPath);
  const realTarget = await realpathIfExists(absTarget);
  if (realTarget) {
    if (!isWithinResolvedRoot(realRoot, realTarget)) {
      throw new Error(`Path escapes workspace: ${targetPath}`);
    }
    return realTarget;
  }

  let probe = path.dirname(absTarget);
  while (!(await realpathIfExists(probe))) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }

  const resolvedProbe = await realpathIfExists(probe);
  if (!resolvedProbe) {
    throw new Error(`Path escapes workspace: ${targetPath}`);
  }

  const resolvedTarget = path.join(resolvedProbe, path.relative(probe, absTarget));
  if (!isWithinResolvedRoot(realRoot, resolvedTarget)) {
    throw new Error(`Path escapes workspace: ${targetPath}`);
  }
  return resolvedTarget;
}

async function getBackgroundTasksDir(root) {
  return path.join(await resolveInWorkspace(root, '.codemini'), 'tasks');
}

function toWorkspaceRelative(root, absPath) {
  return normalizePath(path.relative(path.resolve(root), absPath));
}

function trimLinePreview(line, maxLen = 180) {
  const text = String(line || '').replace(/\t/g, '  ').trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 3)}...`;
}

function splitLines(text) {
  return String(text || '').split('\n');
}

function parseInlineReadRange(value) {
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

function normalizeReadArgs(rawArgs) {
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

  const inlineRange = parseInlineReadRange(normalized.path);
  if (inlineRange) {
    normalized.path = inlineRange.path;
    if (!Number.isFinite(Number(normalized.start_line))) normalized.start_line = inlineRange.start_line;
    if (!Number.isFinite(Number(normalized.end_line))) normalized.end_line = inlineRange.end_line;
  }

  return normalized;
}

function normalizePathArgs(rawArgs, aliases = []) {
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

function normalizePatternArgs(rawArgs, aliases = [], defaultPathAliases = []) {
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

function normalizeWriteArgs(rawArgs) {
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

function findUniqueLineBlock(lines, blockContent) {
  const probeLines = splitLines(blockContent);
  if (probeLines.length === 0 || (probeLines.length === 1 && probeLines[0] === '')) return null;
  const matches = [];
  const lastStart = lines.length - probeLines.length;
  for (let start = 0; start <= lastStart; start += 1) {
    let ok = true;
    for (let offset = 0; offset < probeLines.length; offset += 1) {
      if (lines[start + offset] !== probeLines[offset]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      matches.push({
        start_line: start + 1,
        end_line: start + probeLines.length,
        content: probeLines.join('\n')
      });
      if (matches.length > 1) break;
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function resolveReplaceBlockTarget(state, target) {
  const startLine = Number(target?.start_line);
  const endLine = Number(target?.end_line);
  const oldHash = String(target?.old_hash || '');
  const currentBlock =
    Number.isFinite(startLine) && Number.isFinite(endLine) && startLine > 0 && endLine >= startLine
      ? state.lines.slice(startLine - 1, endLine).join('\n')
      : '';

  if (oldHash && currentBlock && oldHash === sha256(currentBlock)) {
    return {
      start_line: startLine,
      end_line: endLine,
      old_hash: oldHash,
      old_content: currentBlock,
      relocated: false
    };
  }

  const oldContent = String(target?.old_content || '');
  if (oldContent) {
    const relocated = findUniqueLineBlock(state.lines, oldContent);
    if (relocated) {
      return {
        start_line: relocated.start_line,
        end_line: relocated.end_line,
        old_hash: sha256(relocated.content),
        old_content: relocated.content,
        relocated: true
      };
    }
  }

  return null;
}

function detectTextFile(filePath) {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isCodeLikePath(filePath) {
  return CODE_WRITE_GUARD_EXTENSIONS.has(path.extname(String(filePath || '')).toLowerCase());
}

function normalizeFileTypes(args = {}) {
  const explicit = Array.isArray(args?.file_types) ? args.file_types.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean) : [];
  const language = String(args?.language || '').trim().toLowerCase();
  const languageTypes = LANGUAGE_FILE_TYPES[language] || [];
  const merged = [...explicit, ...languageTypes];
  return [...new Set(merged)];
}

async function mapLimit(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return [];
  const maxConcurrent = Math.max(1, Math.min(Number(limit) || 1, list.length));
  const results = new Array(list.length);
  let nextIndex = 0;

  async function runNext() {
    while (nextIndex < list.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(list[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: maxConcurrent }, () => runNext()));
  return results;
}

const WALKER_CONCURRENCY = 8;

async function walkTextFiles(root, startPath = '.', fileTypes = []) {
  const abs = await resolveInWorkspace(root, startPath);
  const allowedExts = new Set((Array.isArray(fileTypes) ? fileTypes : []).map((item) => `.${String(item || '').replace(/^\./, '')}`));

  async function visit(current) {
    const stat = await fs.stat(current);
    if (stat.isDirectory()) {
      const name = path.basename(current);
      if (SKIP_DIRS.has(name)) return [];
      const entries = await fs.readdir(current);
      const nested = await mapLimit(entries, WALKER_CONCURRENCY, async (entry) => visit(path.join(current, entry)));
      return nested.flat();
    }
    if (!detectTextFile(current)) return [];
    if (allowedExts.size > 0 && !allowedExts.has(path.extname(current).toLowerCase())) return [];
    return [current];
  }

  return visit(abs);
}

async function walkWorkspaceEntries(root, startPath = '.', { includeHidden = false } = {}) {
  const abs = await resolveInWorkspace(root, startPath);

  async function visit(current) {
    const stat = await fs.stat(current);
    const relative = toWorkspaceRelative(root, current) || '.';
    const name = path.basename(current);

    if (!includeHidden && name.startsWith('.') && relative !== '.') return [];
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(name) && relative !== '.') return [];
      const entries = await fs.readdir(current);
      const nested = await mapLimit(entries, WALKER_CONCURRENCY, async (entry) => visit(path.join(current, entry)));
      return [{ path: relative, name, type: 'dir' }, ...nested.flat()];
    }

    return [{ path: relative, name, type: 'file' }];
  }

  return visit(abs);
}

function globToRegex(pattern) {
  const normalized = String(pattern || '').replace(/\\/g, '/').trim();
  let regexBody = '';
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    const next = normalized[i + 1];
    const afterNext = normalized[i + 2];
    if (ch === '*' && next === '*' && afterNext === '/') {
      regexBody += '(?:.*/)?';
      i += 2;
      continue;
    }
    if (ch === '*' && next === '*') {
      regexBody += '.*';
      i += 1;
      continue;
    }
    if (ch === '*') {
      regexBody += '[^/]*';
      continue;
    }
    if (ch === '?') {
      regexBody += '[^/]';
      continue;
    }
    regexBody += /[-/\\^$+?.()|[\]{}]/.test(ch) ? `\\${ch}` : ch;
  }
  return new RegExp(`^${regexBody}$`);
}

function findSymbolDefinition(lines, symbol) {
  const escaped = String(symbol || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(String.raw`\bfunction\s+${escaped}\b`),
    new RegExp(String.raw`\basync\s+function\s+${escaped}\b`),
    new RegExp(String.raw`\bexport\s+function\s+${escaped}\b`),
    new RegExp(String.raw`\bexport\s+async\s+function\s+${escaped}\b`),
    new RegExp(String.raw`\bclass\s+${escaped}\b`),
    new RegExp(String.raw`\bconst\s+${escaped}\b`),
    new RegExp(String.raw`\blet\s+${escaped}\b`),
    new RegExp(String.raw`\bvar\s+${escaped}\b`)
  ];
  for (let i = 0; i < lines.length; i += 1) {
    if (patterns.some((pattern) => pattern.test(lines[i]))) {
      return i + 1;
    }
  }
  for (let i = 0; i < lines.length; i += 1) {
    if (new RegExp(String.raw`\b${escaped}\b`).test(lines[i])) {
      return i + 1;
    }
  }
  return 1;
}

function lineIndentSize(line) {
  const match = String(line || '').match(/^\s*/);
  return match ? match[0].length : 0;
}

function findBlockRange(lines, anchorLine) {
  const total = lines.length;
  const anchorIdx = Math.max(0, Math.min(total - 1, Number(anchorLine || 1) - 1));

  let start = anchorIdx;
  for (let i = anchorIdx; i >= 0; i -= 1) {
    const line = String(lines[i] || '');
    if (
      /\b(function|class|interface|type|enum|const|let|var|export)\b/.test(line) ||
      /=>\s*{/.test(line) ||
      /<\w/.test(line)
    ) {
      start = i;
      break;
    }
  }

  let braceDepth = 0;
  let seenBrace = false;
  let end = anchorIdx;
  for (let i = start; i < total; i += 1) {
    const line = String(lines[i] || '');
    for (const ch of line) {
      if (ch === '{') {
        braceDepth += 1;
        seenBrace = true;
      } else if (ch === '}') {
        braceDepth -= 1;
      }
    }
    end = i;
    if (seenBrace && braceDepth <= 0 && i > start) {
      return { startLine: start + 1, endLine: end + 1 };
    }
  }

  const anchorText = String(lines[start] || '');
  if (/^\s*def\b/.test(anchorText) || /:\s*$/.test(anchorText)) {
    const baseIndent = lineIndentSize(anchorText);
    end = start;
    for (let i = start + 1; i < total; i += 1) {
      const line = String(lines[i] || '');
      if (!line.trim()) break;
      if (lineIndentSize(line) <= baseIndent) break;
      end = i;
    }
    return { startLine: start + 1, endLine: end + 1 };
  }

  const baseIndent = lineIndentSize(lines[start]);
  end = start;
  for (let i = start + 1; i < total; i += 1) {
    const line = String(lines[i] || '');
    if (!line.trim()) {
      end = i;
      continue;
    }
    if (lineIndentSize(line) <= baseIndent && i > anchorIdx) break;
    end = i;
  }
  return { startLine: start + 1, endLine: end + 1 };
}

function extractImports(lines) {
  return lines.filter((line) => /^\s*import\b/.test(String(line || ''))).map((line) => trimLinePreview(line, 220));
}

function extractImportSignatures(lines, maxItems = 6) {
  const imports = [];
  for (const line of lines) {
    const text = String(line || '').trim();
    if (!/^import\b/.test(text)) continue;
    imports.push(trimLinePreview(text, 96));
    if (imports.length >= maxItems) break;
  }
  return imports;
}

function extractTypeSignatures(lines, maxItems = 6) {
  const out = [];
  const patterns = [
    /^\s*(?:export\s+)?type\s+[A-Za-z0-9_$]+.*$/,
    /^\s*(?:export\s+)?interface\s+[A-Za-z0-9_$]+.*$/,
    /^\s*(?:export\s+)?enum\s+[A-Za-z0-9_$]+.*$/,
    /^\s*(?:export\s+)?class\s+[A-Za-z0-9_$]+.*$/,
    /^\s*import\s+type\b.*$/
  ];
  for (const line of lines) {
    const text = String(line || '').trim();
    if (!patterns.some((pattern) => pattern.test(text))) continue;
    out.push(trimLinePreview(text, 96));
    if (out.length >= maxItems) break;
  }
  return out;
}

function extractLocalSymbols(lines, sourceSymbol = '') {
  const out = [];
  const seen = new Set();
  const regex = /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)|^\s*(?:export\s+)?class\s+([A-Za-z0-9_$]+)|^\s*(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=/;
  for (let i = 0; i < lines.length; i += 1) {
    const match = String(lines[i] || '').match(regex);
    const name = match?.[1] || match?.[2] || match?.[3] || '';
    if (!name || name === sourceSymbol || seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      line: i + 1,
      signature: trimLinePreview(lines[i], 220)
    });
  }
  return out.slice(0, 8);
}

function extractDirectCalls(lines, symbol, maxItems = 3, excludeRange = null) {
  const escaped = escapeRegex(symbol);
  const out = [];
  for (let i = 0; i < lines.length && out.length < maxItems; i += 1) {
    if (excludeRange && i + 1 >= excludeRange.startLine && i + 1 <= excludeRange.endLine) continue;
    const line = String(lines[i] || '');
    if (!new RegExp(String.raw`\b${escaped}\s*\(`).test(line)) continue;
    const blockLine = findEnclosingSymbolLine(lines, i + 1);
    const owner = blockLine ? trimLinePreview(lines[blockLine - 1], 220) : trimLinePreview(line, 220);
    const ownerName = blockLine ? extractSymbolName(lines[blockLine - 1]) : '';
    if (ownerName === symbol) continue;
    out.push({
      symbol: ownerName || '(anonymous)',
      line: blockLine || i + 1,
      preview: owner
    });
  }
  return out;
}

function extractSymbolName(line) {
  const text = String(line || '');
  const match =
    text.match(/\bfunction\s+([A-Za-z0-9_$]+)/) ||
    text.match(/\bclass\s+([A-Za-z0-9_$]+)/) ||
    text.match(/\bconst\s+([A-Za-z0-9_$]+)\s*=/) ||
    text.match(/^\s*def\s+([A-Za-z0-9_]+)/);
  return match?.[1] || '';
}

function findEnclosingSymbolLine(lines, anchorLine) {
  for (let i = Math.max(0, anchorLine - 1); i >= 0; i -= 1) {
    const name = extractSymbolName(lines[i]);
    if (name) return i + 1;
  }
  return 0;
}

function buildUnifiedDiff(oldContent, newContent, filePath = 'file') {
  const oldLines = splitLines(oldContent);
  const newLines = splitLines(newContent);
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const oldChanged = oldLines.slice(prefix, oldLines.length - suffix);
  const newChanged = newLines.slice(prefix, newLines.length - suffix);
  const oldStart = prefix + 1;
  const newStart = prefix + 1;
  const oldCount = Math.max(1, oldChanged.length);
  const newCount = Math.max(1, newChanged.length);

  const body = [
    `--- ${filePath}`,
    `+++ ${filePath}`,
    `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
    ...oldChanged.map((line) => `-${line}`),
    ...newChanged.map((line) => `+${line}`)
  ];
  return body.join('\n');
}

async function getFileState(root, relativePath) {
  const target = await resolveInWorkspace(root, relativePath);
  const stat = await fs.stat(target);
  const content = await fs.readFile(target, 'utf8');
  return {
    target,
    content,
    lines: splitLines(content),
    stat
  };
}

async function readFile(root, args) {
  const normalizedArgs = normalizeReadArgs(args);
  const target = await resolveInWorkspace(root, normalizedArgs?.path);
  const stat = await fs.stat(target);
  const text = await fs.readFile(target, 'utf8');
  const lines = splitLines(text);
  const totalLines = lines.length;
  const startLineRaw = Number(normalizedArgs?.start_line);
  const endLineRaw = Number(normalizedArgs?.end_line);
  const defaultLines = Number(normalizedArgs?.default_lines || 220);
  const maxChars = Number(normalizedArgs?.max_chars || 24000);
  const wantsMetadataOnly = normalizedArgs?.metadata_only === true || normalizedArgs?.include_content === false;

  let startLine = Number.isFinite(startLineRaw) && startLineRaw > 0 ? startLineRaw : 1;
  let endLine =
    Number.isFinite(endLineRaw) && endLineRaw >= startLine
      ? endLineRaw
      : Math.min(totalLines, startLine + Math.max(1, defaultLines) - 1);
  startLine = Math.max(1, Math.min(startLine, totalLines));
  endLine = Math.max(startLine, Math.min(endLine, totalLines));

  const tokenSeed = `${normalizedArgs?.path}|${stat.size}|${stat.mtimeMs}|${startLine}|${endLine}`;
  const readToken = sha256Hash(tokenSeed).slice(0, 16);

  if (wantsMetadataOnly) {
    return {
      path: normalizedArgs?.path,
      phase: 'metadata',
      size_bytes: stat.size,
      modified_at: new Date(stat.mtimeMs).toISOString(),
      total_lines: totalLines,
      suggested_start_line: startLine,
      suggested_end_line: endLine,
      read_token: readToken,
      next: 'Call read again with include_content=true and this read_token'
    };
  }

  let content = lines.slice(startLine - 1, endLine).join('\n');
  let truncated = false;
  if (maxChars > 0 && content.length > maxChars) {
    content = `${content.slice(0, maxChars)}\n... [truncated by max_chars]`;
    truncated = true;
  }

  // Read deduplication: if same path+range+mtime was read before, return a short stub
  const isDuplicate = checkReadDedup(
    normalizedArgs?.path,
    startLine,
    endLine,
    stat.mtimeMs
  );
  if (isDuplicate) {
    return {
      path: normalizedArgs?.path,
      phase: 'content',
      start_line: startLine,
      end_line: endLine,
      total_lines: totalLines,
      truncated: false,
      unchanged: true,
      content: `File unchanged since last read. The content from the earlier read tool_result in this conversation is still current -- refer to that instead of re-reading.`
    };
  }

  // Resolve enclosing structural symbol via Tree-sitter (best-effort, skipped for large files)
  const shouldResolveEnclosing = text.length <= MAX_AST_ENCLOSING_BYTES && totalLines <= MAX_AST_ENCLOSING_LINES;
  const anchorLine = Math.floor((startLine + endLine) / 2);
  const enclosing = shouldResolveEnclosing ? await findEnclosingSymbol(text, normalizedArgs?.path, anchorLine) : null;

  return {
    path: normalizedArgs?.path,
    phase: 'content',
    start_line: startLine,
    end_line: endLine,
    total_lines: totalLines,
    truncated,
    content,
    ...(enclosing ? { enclosing_symbol: enclosing.name, enclosing_kind: enclosing.kind, enclosing_line: enclosing.start_line } : {})
  };
}

async function writeFile(root, args) {
  const normalizedArgs = normalizeWriteArgs(args);
  const rawPath = String(normalizedArgs?.path || '').trim();
  if (!rawPath) {
    throw new Error('write requires a file path like weather/WeatherForecast.js');
  }
  if (rawPath === '.' || rawPath === './') {
    throw new Error('write requires a file path, not the workspace root');
  }
  const target = await resolveInWorkspace(root, rawPath);
  try {
    const stat = await fs.stat(target);
    if (stat.isDirectory()) {
      throw new Error(`write target is a directory: ${rawPath}`);
    }
  } catch (error) {
    if (error?.code && error.code !== 'ENOENT') throw error;
  }
  let before = '';
  let existed = true;
  try {
    before = await fs.readFile(target, 'utf8');
  } catch {
    existed = false;
  }
  if (existed && !normalizedArgs?.append && !normalizedArgs?.full_file_rewrite && isCodeLikePath(rawPath)) {
    throw new Error(
      'write blocks full overwrite for existing code files by default. Use grep/read -> edit for minimal edits, or pass full_file_rewrite=true when a whole-file rewrite is truly intended.'
    );
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (normalizedArgs?.append) {
    await fs.appendFile(target, normalizedArgs?.content || '', 'utf8');
  } else {
    await fs.writeFile(target, normalizedArgs?.content || '', 'utf8');
  }
  const after = normalizedArgs?.append ? `${before}${normalizedArgs?.content || ''}` : normalizedArgs?.content || '';
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  let changeLine = 0;
  const scanMax = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < scanMax; i += 1) {
    if ((beforeLines[i] || '') !== (afterLines[i] || '')) {
      changeLine = i + 1;
      break;
    }
  }
  const previewStart = Math.max(0, (changeLine || 1) - 1);
  const previewLines = afterLines.slice(previewStart, previewStart + 6);
  return {
    ok: true,
    path: rawPath,
    action: normalizedArgs?.append ? 'append' : existed ? 'overwrite' : 'create',
    changed_line: changeLine || Math.max(1, afterLines.length),
    diff_preview: previewLines.map((line, idx) => `${previewStart + idx + 1}| ${line}`).join('\n')
  };
}

async function prepareDeleteTarget(root, args) {
  const normalizedArgs = normalizePathArgs(args, ['file', 'file_path', 'target', 'directory', 'dir']);
  const rawPath = String(normalizedArgs?.path || '').trim();
  if (!rawPath) {
    throw new Error('delete requires a file or directory path');
  }
  const absRoot = path.resolve(root);
  const realRoot = await fs.realpath(absRoot);
  const originalTarget = path.resolve(absRoot, rawPath);
  if (originalTarget === absRoot) {
    throw new Error('delete requires a path inside the workspace, not the workspace root');
  }
  const resolvedTarget = await resolveInWorkspace(root, rawPath);
  if (resolvedTarget === realRoot) {
    throw new Error('delete requires a path inside the workspace, not the workspace root');
  }

  let rawStat;
  let stat;
  try {
    rawStat = await fs.lstat(originalTarget);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`delete target not found: ${rawPath}`);
    }
    throw error;
  }
  try {
    stat = await fs.stat(resolvedTarget);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const type = stat?.isDirectory?.() ? 'directory' : rawStat.isDirectory() ? 'directory' : 'file';
  const pathInWorkspace = toWorkspaceRelative(root, originalTarget);
  return {
    originalTarget,
    resolvedTarget,
    path: pathInWorkspace,
    name: path.basename(pathInWorkspace),
    type
  };
}

async function deletePath(root, args) {
  const target = await prepareDeleteTarget(root, args);
  await fs.rm(target.originalTarget, { recursive: true, force: false });

  return {
    ok: true,
    path: target.path,
    name: target.name,
    type: target.type,
    deleted: true
  };
}

async function runCommand(root, config, args) {
  const command = args?.command || '';
  if (!command.trim()) {
    throw new Error('run requires command');
  }
  if (
    !config.policy.allow_dangerous_commands &&
    isDangerousCommand(command, config.policy.blocked_command_patterns)
  ) {
    throw new Error('Command blocked by policy');
  }

  const check = evaluateCommandPolicy(command, config, root);
  if (!check.allowed) {
    throw new Error(
      `Command blocked by safe mode: ${check.reason}${check.suggestion ? ` | ${check.suggestion}` : ''}`
    );
  }

  const shouldBackground =
    args?.run_in_background === true ||
    args?.runInBackground === true ||
    args?.background === true ||
    isLikelyLongRunningCommand(command);

  if (shouldBackground) {
    return startBackgroundTask(root, config, args);
  }

  const result = await runShellCommand({
    command,
    cwd: root,
    shell: config.shell.default,
    timeoutMs: config.shell.timeout_ms
  });
  return { ...result, command };
}

function nextBackgroundTaskId() {
  backgroundTaskCounter += 1;
  return `task_${String(backgroundTaskCounter).padStart(3, '0')}`;
}

function normalizeSuccessMatchers(items = []) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => String(item || '').trim()).filter(Boolean);
}

function shellCommandForBackgroundTask(command, shellSpec) {
  return process.platform !== 'win32' && /(?:^|\/)bash(?:\.exe)?$/i.test(shellSpec.command)
    ? `exec ${command}`
    : command;
}

function appendRecentOutput(task, chunk) {
  const lines = String(chunk || '')
    .split(/\r?\n/)
    .map((line) => trimLinePreview(line, 220))
    .filter(Boolean);
  if (lines.length === 0) return;
  for (const line of lines) {
    backgroundTaskLogCursorCounter += 1;
    task.recentLogs.push({ cursor: backgroundTaskLogCursorCounter, line });
  }
  if (task.recentLogs.length > BACKGROUND_TASK_RECENT_OUTPUT_LIMIT) {
    task.recentLogs.splice(0, task.recentLogs.length - BACKGROUND_TASK_RECENT_OUTPUT_LIMIT);
  }
}

function matchesTaskStartupSuccess(task, text) {
  const value = String(text || '');
  if (!value) return false;
  if (hasReadyOutput(value)) return true;
  return task.successMatchers.some((matcher) => value.toLowerCase().includes(matcher.toLowerCase()));
}

function markTaskReady(task, source = 'output') {
  if (task.startupConfirmed) return;
  task.startupConfirmed = true;
  task.startupSource = source;
  task.status = 'running';
}

function serviceUrlForPort(port) {
  const portNumber = Number(port);
  return Number.isInteger(portNumber) && portNumber > 0 ? `http://127.0.0.1:${portNumber}` : '';
}

function normalizeHttpProbe(value) {
  if (!value || typeof value !== 'object') return null;
  const url = String(value.url || '').trim();
  if (!url) return null;
  const expectStatus = Number(value.expect_status ?? value.expectStatus ?? 200);
  return {
    url,
    expect_status: Number.isInteger(expectStatus) ? expectStatus : 200
  };
}

function snapshotBackgroundTask(task, tail = 12) {
  const recentOutput = Array.isArray(task.recentLogs)
    ? task.recentLogs.slice(-Math.max(1, tail)).map((item) => item.line)
    : [];
  const latestCursor =
    Array.isArray(task.recentLogs) && task.recentLogs.length > 0
      ? task.recentLogs[task.recentLogs.length - 1].cursor
      : 0;
  return {
    task_id: task.taskId,
    pid: task.child?.pid || null,
    command: task.command,
    cwd: task.cwd,
    status: task.status,
    background: true,
    kind: task.intentKind,
    startup_confirmed: task.startupConfirmed,
    startup_source: task.startupSource || '',
    http_probe: task.httpProbe || undefined,
    url: serviceUrlForPort(task.portProbe) || undefined,
    output_file: task.outputFile,
    recent_output: recentOutput,
    recent_logs: recentOutput,
    log_cursor: latestCursor,
    exit_code: task.exitCode ?? undefined,
    signal: task.signal ?? undefined,
    duration_ms: Date.now() - task.startedAt
  };
}

function listBackgroundTaskSnapshots() {
  return Array.from(backgroundTaskRegistry.values()).map((task) => snapshotBackgroundTask(task, 4));
}

function probePortOnce(port, host = '127.0.0.1', timeoutMs = 250) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(Number(port), host);
  });
}

async function probeHttpOnce(httpProbe, timeoutMs = 400) {
  if (!httpProbe?.url) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(httpProbe.url, {
      method: 'GET',
      signal: controller.signal
    });
    return response.status === Number(httpProbe.expect_status || 200);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function queueBackgroundTaskOutputWrite(task, chunk) {
  if (!task?.outputFileAbs) return;
  task.outputWrite = (task.outputWrite || Promise.resolve())
    .then(() => fs.appendFile(task.outputFileAbs, String(chunk || ''), 'utf8'))
    .catch(() => {});
}

async function startBackgroundTask(root, config, args) {
  const command = String(args?.command || args?.cmd || '').trim();
  if (!command) throw new Error('run requires command');
  if (
    !config.policy.allow_dangerous_commands &&
    isDangerousCommand(command, config.policy.blocked_command_patterns)
  ) {
    throw new Error('Command blocked by policy');
  }
  const check = evaluateCommandPolicy(command, config, root);
  if (!check.allowed) {
    throw new Error(
      `Command blocked by safe mode: ${check.reason}${check.suggestion ? ` | ${check.suggestion}` : ''}`
    );
  }

  const shellSpec = resolveShell(config.shell.default);
  const taskId = nextBackgroundTaskId();
  const startupTimeoutMs = Math.max(250, Number(args?.startup_timeout_ms || args?.startupTimeoutMs || 20000));
  const successMatchers = normalizeSuccessMatchers(args?.success_matchers || args?.successMatchers);
  const portProbe = Number(args?.port_probe || args?.portProbe || 0) || 0;
  const httpProbe = normalizeHttpProbe(args?.http_probe || args?.httpProbe);
  const outputDir = await getBackgroundTasksDir(root);
  await fs.mkdir(outputDir, { recursive: true });
  const outputFileAbs = path.join(outputDir, `${taskId}.log`);
  await fs.writeFile(outputFileAbs, '', 'utf8');

  const task = {
    taskId,
    command,
    cwd: root,
    child: spawn(shellSpec.command, [...shellSpec.args, shellCommandForBackgroundTask(command, shellSpec)], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe']
    }),
    startedAt: Date.now(),
    status: 'starting',
    intentKind: classifyCommandIntent(command).kind,
    startupConfirmed: false,
    startupSource: '',
    successMatchers,
    portProbe,
    httpProbe,
    outputFileAbs,
    outputFile: toWorkspaceRelative(root, outputFileAbs),
    recentLogs: [],
    exitCode: null,
    signal: null,
    outputWrite: Promise.resolve()
  };
  backgroundTaskRegistry.set(taskId, task);

  task.closePromise = new Promise((resolve) => {
    task.child.on('close', (code, signal) => {
      task.exitCode = code;
      task.signal = signal;
      task.status = task.status === 'stopped' ? 'stopped' : 'exited';
      resolve();
    });
  });

  const onOutput = (chunk) => {
    appendRecentOutput(task, chunk);
    queueBackgroundTaskOutputWrite(task, chunk);
    if (matchesTaskStartupSuccess(task, chunk)) {
      markTaskReady(task, 'output');
      if (task._finishStartup) task._finishStartup();
    }
  };
  task.child.stdout.on('data', onOutput);
  task.child.stderr.on('data', onOutput);
  task.child.on('error', (error) => {
    appendRecentOutput(task, error?.message || String(error));
    queueBackgroundTaskOutputWrite(task, error?.message || String(error));
    task.status = 'exited';
    if (task._finishStartup) task._finishStartup();
  });

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      clearInterval(portHandle);
      clearInterval(httpHandle);
      task._finishStartup = null;
      resolve();
    };
    task._finishStartup = finish;
    if (task.startupConfirmed || task.status === 'exited') {
      finish();
      return;
    }
    const timeoutHandle = setTimeout(() => {
      if (task.status === 'starting') {
        if (!task.startupConfirmed) {
          markTaskReady(task, 'startup_window');
        } else {
          task.status = 'running';
        }
      }
      finish();
    }, startupTimeoutMs);
    const portHandle =
      portProbe > 0
        ? setInterval(async () => {
            const open = await probePortOnce(portProbe);
            if (open) {
              markTaskReady(task, 'port_probe');
              finish();
            }
          }, BACKGROUND_TASK_POLL_MS)
        : null;
    const httpHandle =
      httpProbe
        ? setInterval(async () => {
            const ok = await probeHttpOnce(httpProbe);
            if (ok) {
              markTaskReady(task, 'http_probe');
              finish();
            }
          }, BACKGROUND_TASK_POLL_MS)
        : null;
    task.child.once('close', () => finish());
  });

  if (task.status === 'starting') {
    task.status = 'running';
  }
  return snapshotBackgroundTask(task);
}

function getBackgroundTaskOrThrow(taskId) {
  const task = backgroundTaskRegistry.get(String(taskId || '').trim());
  if (!task) throw new Error(`Unknown background task: ${taskId}`);
  return task;
}

async function getBackgroundTask(_root, args) {
  const task = getBackgroundTaskOrThrow(args?.task_id || args?.taskId);
  return snapshotBackgroundTask(task);
}

async function listBackgroundTasks() {
  return {
    tasks: listBackgroundTaskSnapshots()
  };
}

async function stopBackgroundTask(_root, args) {
  const task = getBackgroundTaskOrThrow(args?.task_id || args?.taskId);
  if (task.status === 'stopped' || task.status === 'exited') {
    return { ...snapshotBackgroundTask(task), stopped: true };
  }
  task.status = 'stopped';
  terminateChild(task.child, 'SIGTERM');
  setTimeout(() => terminateChild(task.child, 'SIGKILL'), 200);
  await Promise.race([
    task.closePromise,
    new Promise((resolve) => setTimeout(resolve, 500))
  ]);
  return { ...snapshotBackgroundTask(task), stopped: true };
}

async function grep(root, args) {
  const normalizedArgs = normalizePatternArgs(args, ['query', 'symbol', 'q'], ['directory', 'dir', 'cwd']);
  const pattern = String(normalizedArgs?.pattern || '').trim();
  if (!pattern) throw new Error('grep requires pattern');
  const maxResults = Math.max(1, Math.min(200, Number(normalizedArgs?.max_results || 50)));
  const caseSensitive = Boolean(normalizedArgs?.case_sensitive);
  const files = await walkTextFiles(root, normalizedArgs?.path || '.', normalizeFileTypes(normalizedArgs));
  const regex = normalizedArgs?.regex
    ? new RegExp(pattern, caseSensitive ? 'g' : 'gi')
    : new RegExp(escapeRegex(pattern), caseSensitive ? 'g' : 'gi');
  const matches = [];

  for (const filePath of files) {
    const content = await fs.readFile(filePath, 'utf8');
    const lines = splitLines(content);
    for (let idx = 0; idx < lines.length; idx += 1) {
      const line = String(lines[idx] || '');
      regex.lastIndex = 0;
      const found = regex.exec(line);
      if (!found) continue;
      matches.push({
        path: toWorkspaceRelative(root, filePath),
        line: idx + 1,
        column: Math.max(1, Number(found.index || 0) + 1),
        preview: trimLinePreview(line)
      });
      if (matches.length >= maxResults) {
        return { pattern, matches, truncated: true };
      }
    }
  }

  return { pattern, matches, truncated: false };
}

async function glob(root, args) {
  const normalizedArgs = normalizePatternArgs(args, ['glob', 'query'], ['directory', 'dir', 'cwd']);
  const pattern = String(normalizedArgs?.pattern || '').trim();
  if (!pattern) throw new Error('glob requires pattern');
  const maxResults = Math.max(1, Math.min(500, Number(normalizedArgs?.max_results || 200)));
  const regex = globToRegex(pattern);
  const entries = await walkWorkspaceEntries(root, normalizedArgs?.path || '.', {
    includeHidden: Boolean(normalizedArgs?.include_hidden)
  });
  const matches = entries
    .filter((entry) => entry.type === 'file' && regex.test(entry.path))
    .slice(0, maxResults)
    .map((entry) => entry.path);
  return {
    pattern,
    matches,
    truncated: entries.filter((entry) => entry.type === 'file' && regex.test(entry.path)).length > matches.length
  };
}

async function list(root, args) {
  const normalizedArgs = normalizePathArgs(args, ['dir', 'directory', 'target']);
  const relativePath = String(normalizedArgs?.path || '.').trim() || '.';
  const target = await resolveInWorkspace(root, relativePath);
  const entries = await fs.readdir(target, { withFileTypes: true });
  const includeHidden = Boolean(normalizedArgs?.include_hidden);
  const items = entries
    .filter((entry) => includeHidden || !entry.name.startsWith('.'))
    .map((entry) => ({
      name: entry.name,
      path: path.posix.join(relativePath === '.' ? '' : relativePath.replace(/\\/g, '/'), entry.name) || entry.name,
      type: entry.isDirectory() ? 'dir' : 'file'
    }))
    .sort((left, right) => {
      if (left.type !== right.type) return left.type === 'dir' ? -1 : 1;
      return left.path.localeCompare(right.path);
    });
  return {
    path: relativePath,
    items
  };
}

async function readBlock(root, args) {
  const relativePath = String(args?.path || '').trim();
  if (!relativePath) throw new Error('read_block requires path');
  const { lines } = await getFileState(root, relativePath);
  const symbol = String(args?.symbol || '').trim();
  const anchorLine = symbol ? findSymbolDefinition(lines, symbol) : Number(args?.line || args?.anchor_line || 1);
  const range = findBlockRange(lines, anchorLine);
  return {
    file: relativePath,
    symbol: symbol || undefined,
    mode: symbol ? 'symbol' : 'block',
    start_line: range.startLine,
    end_line: range.endLine,
    content: lines.slice(range.startLine - 1, range.endLine).join('\n')
  };
}

async function readSymbolContext(root, args) {
  const relativePath = String(args?.path || '').trim();
  const symbol = String(args?.symbol || '').trim();
  if (!relativePath || !symbol) throw new Error('read_symbol_context requires path and symbol');
  const { lines } = await getFileState(root, relativePath);
  const mainBlock = await readBlock(root, { path: relativePath, symbol });
  return {
    file: relativePath,
    symbol,
    main_block: mainBlock,
    related: {
      imports: extractImports(lines),
      import_signatures: extractImportSignatures(lines, Number(args?.max_related_imports || 4)),
      type_signatures: extractTypeSignatures(lines, Number(args?.max_related_types || 4)),
      local_symbols: extractLocalSymbols(lines, symbol),
      calls: extractDirectCalls(lines, symbol, Number(args?.max_related_calls || 3), {
        startLine: mainBlock.start_line,
        endLine: mainBlock.end_line
      })
    }
  };
}

async function validateEdit(root, args) {
  const relativePath = String(args?.path || '').trim();
  const kind = String(args?.kind || '').trim();
  if (!relativePath || !kind) throw new Error('validate_edit requires path and kind');
  const { content, lines } = await getFileState(root, relativePath);

  if (kind === 'replace_block') {
    const startLine = Number(args?.target?.start_line || args?.start_line);
    const endLine = Number(args?.target?.end_line || args?.end_line);
    if (!Number.isFinite(startLine) || !Number.isFinite(endLine) || startLine <= 0 || endLine < startLine) {
      throw new Error('replace_block validation requires target.start_line and target.end_line');
    }
    const resolved = resolveReplaceBlockTarget({ content, lines }, {
      start_line: startLine,
      end_line: endLine,
      old_hash: args?.target?.old_hash,
      old_content: args?.target?.old_content
    });
    const oldBlock = resolved?.old_content || lines.slice(startLine - 1, endLine).join('\n');
    return {
      ok: true,
      path: relativePath,
      kind,
      target: {
        start_line: resolved?.start_line || startLine,
        end_line: resolved?.end_line || endLine,
        old_hash: sha256(oldBlock),
        old_content: oldBlock
      },
      file_hash: sha256(content),
      relocated: Boolean(resolved?.relocated)
    };
  }

  if (kind === 'replace_text' || kind === 'insert_before' || kind === 'insert_after') {
    const probe = String(args?.old_text || args?.anchor_text || '');
    if (!probe) throw new Error(`${kind} validation requires old_text or anchor_text`);
    const occurrences = content.split(probe).length - 1;
    return {
      ok: occurrences === 1,
      path: relativePath,
      kind,
      occurrences,
      reason: occurrences === 1 ? 'unique match' : occurrences === 0 ? 'anchor not found' : 'anchor not unique',
      file_hash: sha256(content)
    };
  }

  throw new Error(`validate_edit does not support kind: ${kind}`);
}

function editResult(pathText, action, beforeContent, afterContent, changedLine = 1) {
  const afterLines = splitLines(afterContent);
  const previewStart = Math.max(0, changedLine - 1);
  const diffPreview = afterLines.slice(previewStart, previewStart + 6).map((line, idx) => `${previewStart + idx + 1}| ${line}`).join('\n');
  return {
    ok: true,
    path: pathText,
    action,
    changed_line: changedLine,
    diff_preview: diffPreview,
    diff: buildUnifiedDiff(beforeContent, afterContent, pathText),
    new_hash: sha256(afterContent)
  };
}

async function replaceBlock(root, args) {
  const relativePath = String(args?.path || '').trim();
  const newContent = String(args?.new_content || args?.content || '');
  const target = args?.target || {};
  const state = await getFileState(root, relativePath);
  const resolved = resolveReplaceBlockTarget(state, target);
  if (!resolved) {
    throw new Error('replace_block old_hash mismatch; retry through edit with a symbol or line hint');
  }
  const nextLines = [
    ...state.lines.slice(0, resolved.start_line - 1),
    ...splitLines(newContent),
    ...state.lines.slice(resolved.end_line)
  ];
  const afterContent = nextLines.join('\n');
  await fs.writeFile(state.target, afterContent, 'utf8');
  return editResult(relativePath, 'replace_block', state.content, afterContent, resolved.start_line);
}

async function replaceText(root, args) {
  const relativePath = String(args?.path || '').trim();
  const oldText = String(args?.old_text || '');
  const newText = String(args?.new_text || '');
  const state = await getFileState(root, relativePath);
  const occurrences = state.content.split(oldText).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      occurrences === 0
        ? 'replace_text old_text not found; use edit with a symbol or line hint for block edits'
        : 'replace_text old_text not unique; use a larger unique fragment or retry through edit'
    );
  }
  const afterContent = state.content.replace(oldText, newText);
  await fs.writeFile(state.target, afterContent, 'utf8');
  const changedLine = splitLines(state.content.slice(0, state.content.indexOf(oldText))).length;
  return editResult(relativePath, 'replace_text', state.content, afterContent, changedLine);
}

async function insertRelative(root, args, mode) {
  const relativePath = String(args?.path || '').trim();
  const anchorText = String(args?.anchor_text || '');
  const content = String(args?.content || '');
  const state = await getFileState(root, relativePath);
  const occurrences = state.content.split(anchorText).length - 1;
  if (occurrences !== 1) {
    throw new Error(occurrences === 0 ? `${mode} anchor not found` : `${mode} anchor not unique`);
  }
  const replacement = mode === 'insert_before' ? `${content}${anchorText}` : `${anchorText}${content}`;
  const afterContent = state.content.replace(anchorText, replacement);
  await fs.writeFile(state.target, afterContent, 'utf8');
  const changedLine = splitLines(state.content.slice(0, state.content.indexOf(anchorText))).length;
  return editResult(relativePath, mode, state.content, afterContent, changedLine);
}

async function openTarget(root, args) {
  const file = String(args?.file || args?.path || '').trim();
  if (!file) throw new Error('open_target requires file');
  const symbol = String(args?.symbol || '').trim();
  const line = Number(args?.line || 1);
  const mainBlock = symbol
    ? await readSymbolContext(root, {
        path: file,
        symbol,
        max_related_calls: args?.max_related_calls,
        max_related_imports: args?.max_related_imports,
        max_related_types: args?.max_related_types
      })
    : { file, symbol: '', main_block: await readBlock(root, { path: file, line }), related: { imports: [], local_symbols: [] } };
  const block = mainBlock.main_block || mainBlock;
  return {
    file,
    symbol: symbol || undefined,
    main_block: block,
    related: mainBlock.related || { imports: [], local_symbols: [] },
    edit: {
      start_line: block.start_line,
      end_line: block.end_line,
      old_hash: sha256(block.content),
      old_content: block.content
    }
  };
}

function normalizeEditTargetArgs(args = {}) {
  const file = String(args?.file || args?.path || args?.file_path || '').trim();
  const nestedEdit = args?.edit && typeof args.edit === 'object' ? args.edit : null;
  if (nestedEdit) {
    const normalizedEdit = { ...nestedEdit };
    if (normalizedEdit.new_content == null && normalizedEdit.content != null) {
      normalizedEdit.new_content = normalizedEdit.content;
    }
    if (normalizedEdit.new_text == null && normalizedEdit.content != null && normalizedEdit.old_text != null) {
      normalizedEdit.new_text = normalizedEdit.content;
    }
    return {
      file,
      ast_target: normalizedEdit.ast_target ?? args?.ast_target,
      edit: normalizedEdit
    };
  }
  const topLevelOldText = args?.old_text ?? args?.old_string;
  const topLevelContent = args?.content;
  return {
    file,
    ast_target: args?.ast_target,
    edit: {
      kind: args?.kind,
      target: args?.target,
      new_content: args?.new_content ?? args?.content,
      old_text: args?.old_text,
      new_text: args?.new_text ?? (topLevelOldText != null && topLevelContent != null ? topLevelContent : undefined),
      old_string: args?.old_string,
      new_string: args?.new_string,
      anchor_text: args?.anchor_text,
      content: args?.content
    }
  };
}

async function editTarget(root, args) {
  const normalized = normalizeEditTargetArgs(args);
  const file = normalized.file;
  const astTarget = normalized.ast_target;
  const edit = normalized.edit || {};
  let kind = String(edit.kind || '').trim();
  if (edit.old_text == null && edit.old_string != null) {
    edit.old_text = edit.old_string;
  }
  if (edit.new_text == null && edit.new_string != null) {
    edit.new_text = edit.new_string;
  }
  const hasContent = edit.new_content != null || edit.content != null;
  const hasTargetHint = Boolean(edit.symbol || args?.symbol || edit.line || args?.line || edit.target);
  if (!kind) {
    if (hasContent && hasTargetHint) {
      kind = 'replace_block';
    } else if (edit.old_text != null && (edit.new_text != null || edit.content != null)) {
      kind = 'replace_text';
    } else if ((edit.anchor_text != null || edit.target_text != null) && (edit.content != null || edit.new_content != null)) {
      kind = String(edit.position || edit.mode || args?.position || '').trim() === 'after' ? 'insert_after' : 'insert_before';
    } else if (hasContent) {
      kind = 'rewrite_file';
    }
  }
  if (!file || !kind) {
    const recentFile = String(args?.recent_file || '').trim();
    const rawArgs = typeof args?._raw === 'string' && args._raw.trim() ? ` Raw tool arguments: ${args._raw.trim()}.` : '';
    const hint = recentFile
      ? ` If you meant the recently read file ${recentFile}, use edit with {file:"${recentFile}", old_text:"...", new_text:"..."} for a text replacement, or {file:"${recentFile}", edit:{kind:"rewrite_file", new_content:"..."}} for a full rewrite.`
      : ' Use edit with {file:"path", old_text:"...", new_text:"..."} for a text replacement, or {file:"path", edit:{kind:"rewrite_file", new_content:"..."}} for a full rewrite.';
    throw new Error(`edit requires file and edit.kind.${rawArgs}${hint}`);
  }
  if (astTarget) {
    if (kind !== 'replace_block') {
      throw new Error('AST-scoped edit only supports replace_block');
    }
    const resolved = await resolveAstTarget(root, file, astTarget);
    const beforeContent = resolved.content;
    const node = resolved.node;
    const afterContent = `${beforeContent.slice(0, node.startIndex)}${edit.new_content || ''}${beforeContent.slice(node.endIndex)}`;
    await fs.writeFile(resolved.absolutePath, afterContent, 'utf8');
    resolved.tree.delete();
    resolved.parser.delete();
    return editResult(file, 'replace_block', beforeContent, afterContent, node.startPosition.row + 1);
  }
  if (kind === 'replace_block') {
    const resolvedTarget =
      edit.target ||
      (
        await openTarget(root, {
          file,
          symbol: edit.symbol || args?.symbol,
          line: edit.line || args?.line
        })
      ).edit;
    try {
      return await replaceBlock(root, {
        path: file,
        target: resolvedTarget,
        new_content: edit.new_content
      });
    } catch (error) {
      if (!/old_hash mismatch/i.test(String(error?.message || ''))) throw error;
      const validation = await validateEdit(root, {
        path: file,
        kind: 'replace_block',
        target: resolvedTarget
      });
      return replaceBlock(root, {
        path: file,
        target: validation.target,
        new_content: edit.new_content
      });
    }
  }
  if (kind === 'replace_text') {
    return replaceText(root, {
      path: file,
      old_text: edit.old_text,
      new_text: edit.new_text
    });
  }
  if (kind === 'insert_before') {
    return insertRelative(root, { path: file, anchor_text: edit.anchor_text, content: edit.content }, 'insert_before');
  }
  if (kind === 'insert_after') {
    return insertRelative(root, { path: file, anchor_text: edit.anchor_text, content: edit.content }, 'insert_after');
  }
  if (kind === 'rewrite_file') {
    return writeFile(root, {
      path: file,
      content: edit.new_content ?? edit.content ?? '',
      full_file_rewrite: true
    });
  }
  throw new Error(`edit does not support kind: ${kind}`);
}

export function getBuiltinTools({ workspaceRoot = process.cwd(), config, onSystemEvent, getTodos, onTodosUpdate }) {
  const emitSystemTool = (event) => {
    if (typeof onSystemEvent === 'function' && event) onSystemEvent(event);
  };
  const astSelectionCache = new Map();
  let lastAstTarget = null;
  let lastReadPath = '';
  const rememberAstSelection = (filePath, astTarget) => {
    const key = String(filePath || '').trim();
    if (!key || !astTarget) return;
    lastAstTarget = astTarget;
    astSelectionCache.set(key, astTarget);
  };
  const hasExplicitBlockHints = (args = {}) =>
    Boolean(
      args?.ast_target ||
        args?.symbol ||
        args?.line ||
        args?.target ||
        args?.edit?.ast_target ||
        args?.edit?.symbol ||
        args?.edit?.line ||
        args?.edit?.target
    );
  const resolveCachedAstTarget = (args = {}, { requireAstScope = false } = {}) => {
    const file = String(args?.path || args?.file || args?.ast_target?.path || '').trim();
    if (args?.ast_target) return args.ast_target;
    if (file) {
      if (requireAstScope && hasExplicitBlockHints(args)) return null;
      return astSelectionCache.get(file) || lastAstTarget || null;
    }
    return lastAstTarget || null;
  };
  const ensureProjectIndex = async () => {
    const eventId = `project-index:${Date.now()}`;
    const name = 'project_index(.codemini-project/project-map.json,.codemini-project/file-index.json)';
    try {
      const result = await initializeProjectIndex(workspaceRoot);
      if (result?.skipped || !result?.summary) {
        return result;
      }
      emitSystemTool({ type: 'system_tool:end', id: eventId, name, summary: result?.summary });
      return result;
    } catch (error) {
      emitSystemTool({
        type: 'system_tool:error',
        id: eventId,
        name,
        summary: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  };
  const refreshProjectFile = async (filePath) => {
    const relativePath = String(filePath || '').trim();
    if (!relativePath) return null;
    const eventId = `file-index:${relativePath}:${Date.now()}`;
    const name = `file_index(${relativePath})`;
    try {
      const result = await refreshIndexedFile(workspaceRoot, relativePath);
      if (!result?.summary) {
        return result;
      }
      emitSystemTool({
        type: 'system_tool:end',
        id: eventId,
        name,
        summary: result?.summary || `updated .codemini-project for ${relativePath}`
      });
      return result;
    } catch (error) {
      emitSystemTool({
        type: 'system_tool:error',
        id: eventId,
        name,
        summary: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  };
  const primaryDefinitions = [
    {
      type: 'function',
      function: {
        name: 'read',
        description:
          'Inspect code or text files. Use read(path) for normal file or line-window reads, read(ast_target=...) for a node-scoped AST read, and read(path, query=..., capture_name=...) to run an inline Tree-sitter query before returning the first matched node. Prefer the AST forms when targeting a function, class, or method and you want tighter context. Demo-style aliases like file_path, offset, and limit are accepted. Use metadata_only=true only when you want file metadata without content. Do not use run with cat, head, or tail for file reads.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to read. You can also include an inline range like src/app.ts:10-40.' },
            file_path: { type: 'string', description: 'Alias for path' },
            start_line: { type: 'number', description: '1-based start line' },
            end_line: { type: 'number', description: 'Inclusive end line' },
            offset: { type: 'number', description: 'Alias for start_line' },
            limit: { type: 'number', description: 'Number of lines to read starting from offset/start_line' },
            max_chars: { type: 'number', description: 'Max chars to return' },
            include_content: { type: 'boolean', description: 'Legacy compatibility flag. Content is returned by default.' },
            read_token: { type: 'string', description: 'Legacy compatibility token. No longer required for content reads.' },
            metadata_only: { type: 'boolean', description: 'Set true to return metadata without content.' },
            ast_target: { type: 'object', description: 'AST target from ast_query or a prior AST selection. When provided, read returns that node instead of a line window.' },
            query: { type: 'string', description: 'Optional Tree-sitter query to run inline before reading the first matched AST node. Use with path for one-shot function/class/method reads.' },
            capture_name: { type: 'string', description: 'Optional capture name to select when query is provided.' },
            language: { type: 'string', description: 'Optional Tree-sitter language override for AST reads or inline queries.' }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'grep',
        description:
          'Search file contents. Use this for code search before read or edit. Aliases like query and directory are accepted. Do not use run with grep or rg for normal code search.',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Search pattern' },
            query: { type: 'string', description: 'Alias for pattern' },
            path: { type: 'string', description: 'Directory or file to search' },
            directory: { type: 'string', description: 'Alias for path' },
            regex: { type: 'boolean', description: 'Treat pattern as regex' },
            case_sensitive: { type: 'boolean', description: 'Case-sensitive matching' },
            max_results: { type: 'number', description: 'Max matches to return' },
            language: { type: 'string', description: 'Filter by language' },
            file_types: { type: 'array', items: { type: 'string' }, description: 'Filter by file glob' }
          },
          required: ['pattern']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list',
        description: 'List files and directories in a workspace path. Use this for quick directory discovery before deeper reads. Aliases like directory are accepted, and plain string paths are tolerated by the runtime.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path to list' },
            directory: { type: 'string', description: 'Alias for path' },
            include_hidden: { type: 'boolean', description: 'Include dotfiles' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'glob',
        description:
          'Find files by glob pattern. Use this when you already know a filename pattern such as src/**/*.ts. Aliases like query and directory are accepted.',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Glob pattern' },
            path: { type: 'string', description: 'Directory to search' },
            query: { type: 'string', description: 'Alias for pattern' },
            directory: { type: 'string', description: 'Alias for path' },
            include_hidden: { type: 'boolean', description: 'Include dotfiles' },
            max_results: { type: 'number', description: 'Max results' }
          },
          required: ['pattern']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'query_project_index',
        description:
          'Query the lightweight project index before broad file reads. Uses both project-map metadata and file-index symbols to suggest the most relevant files for the current task.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Task or code search phrase such as "login auth" or "tui presenters"' },
            path: { type: 'string', description: 'Optional path prefix like src or src/auth to narrow results' },
            path_prefix: { type: 'string', description: 'Alias for path' },
            language: { type: 'string', description: 'Optional language filter such as ts, js, python, or go' },
            max_results: { type: 'number', description: 'Max result files to return' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'edit',
        description:
          'Edit existing files. Prefer one of these shapes: 1) {file, old_text, new_text} for exact text replacement, 2) {file, symbol, edit:{kind:"replace_block", new_content:"..."}} for block replacement, 3) {file, anchor_text, position:"before"|"after", content:"..."} for inserts. Demo-style aliases {file_path, old_string, new_string} are also accepted. Read first unless the exact target is already known, and prefer read(ast_target=...) or read(path, query=...) before symbol- or block-level edits when you want tighter context. Prefer this over write for existing code changes.',
        parameters: {
          type: 'object',
          properties: {
            file: { type: 'string', description: 'File path to edit' },
            path: { type: 'string', description: 'Alias for file' },
            file_path: { type: 'string', description: 'Alias for file, compatible with simpler demo-style tool calls' },
            new_content: { type: 'string', description: 'Replacement content' },
            old_text: { type: 'string', description: 'Exact text to replace' },
            new_text: { type: 'string', description: 'Replacement text' },
            old_string: { type: 'string', description: 'Alias for old_text' },
            new_string: { type: 'string', description: 'Alias for new_text' },
            anchor_text: { type: 'string', description: 'Anchor text for inserts' },
            content: { type: 'string', description: 'Content to insert or append' },
            position: { type: 'string', description: 'before or after' },
            kind: { type: 'string', description: 'replace_block, replace_text, insert_before, insert_after, or rewrite_file' },
            target: { type: 'object', description: 'Location object with symbol or line info' },
            ast_target: { type: 'object', description: 'AST target from ast_query' },
            symbol: { type: 'string', description: 'Symbol to target' },
            line: { type: 'number', description: 'Line to target' },
            edit: { type: 'object', description: 'Structured edit input' }
          },
          required: ['file']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'write',
        description:
          'Create a new file or overwrite a file. Always include path and content. Aliases like file, file_path, text, and new_content are accepted. Use this for new files or explicit full rewrites only. Example: {path:"src/page.html", content:"..."} . If the file path is not decided yet, do not call write yet. Prefer edit for existing code changes.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Required file path like src/app.js or pages/index.html. Never omit this.' },
            file_path: { type: 'string', description: 'Alias for path, compatible with simpler demo-style tool calls' },
            file: { type: 'string', description: 'Alias for path' },
            content: { type: 'string', description: 'Content to write' },
            text: { type: 'string', description: 'Alias for content' },
            new_content: { type: 'string', description: 'Alias for content' },
            append: { type: 'boolean', description: 'Append instead of overwrite' },
            full_file_rewrite: { type: 'boolean', description: 'Set true for whole-file rewrites' }
          },
          required: ['path', 'content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'delete',
        description:
          'Delete a file or directory inside the workspace. Use path, file, or file_path to point at the target. Missing targets fail. Workspace escape attempts are rejected.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File or directory path to delete' },
            file: { type: 'string', description: 'Alias for path' },
            file_path: { type: 'string', description: 'Alias for path' },
            directory: { type: 'string', description: 'Alias for path' },
            dir: { type: 'string', description: 'Alias for path' }
          },
          required: ['path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'update_todos',
        description:
          'Create or replace the structured todo checklist for the current session. Use this proactively for complex single-task work to track progress. Provide the full current list each time, and keep exactly one item in_progress when work is actively underway.',
        parameters: {
          type: 'object',
          properties: {
            todos: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  content: { type: 'string', description: 'Imperative task text such as "Run tests"' },
                  activeForm: { type: 'string', description: 'Present continuous form such as "Running tests"' },
                  status: { type: 'string', description: 'pending, in_progress, or completed' }
                },
                required: ['content', 'activeForm', 'status']
              },
              description: 'The full current todo checklist for this session'
            }
          },
          required: ['todos']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'run',
        description:
          'Run a shell command. Use this for one-shot commands like install/build/test, and also for long-running commands by setting run_in_background=true. Long-running commands may also be backgrounded automatically.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command to execute' },
            timeout: { type: 'number', description: 'Timeout in milliseconds' },
            run_in_background: { type: 'boolean', description: 'Run in the background and return a task handle immediately' },
            startup_timeout_ms: { type: 'number', description: 'Background startup wait window in milliseconds' },
            success_matchers: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional startup success phrases to look for in command output'
            },
            port_probe: { type: 'number', description: 'Optional localhost port to probe for readiness' },
            http_probe: {
              type: 'object',
              properties: {
                url: { type: 'string' },
                expect_status: { type: 'number' }
              },
              description: 'Optional HTTP readiness probe for a background task'
            }
          },
          required: ['command']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'tool_search',
        description:
          'Load one deferred tool schema by name. Use this when a needed tool is not in the current tool list.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Tool name to load, or "all"' }
          },
          required: ['query']
        }
      }
    }
  ];

  const deferredDefinitions = {
    ast_query: {
      type: 'function',
      function: {
        name: 'ast_query',
        description:
          'Run a Tree-sitter query on a code file and return ast_target objects. Use this for advanced AST workflows such as multi-match selection, explicit node caching, or when you plan to reuse ast_target across follow-up reads or edits. For a common one-shot function, class, or method read, prefer read(path, query=...) or read(ast_target=...).',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            language: { type: 'string' },
            query: { type: 'string' },
            capture_name: { type: 'string' },
            max_results: { type: 'number' }
          },
          required: ['path', 'query']
        }
      }
    },
    read_ast_node: {
      type: 'function',
      function: {
        name: 'read_ast_node',
        description:
          'Read a previously selected AST node with compact structural context. Use this after ast_query when you want an explicit follow-up read of a cached node before a scoped structural edit. For common one-shot AST reads, prefer read(ast_target=...) or read(path, query=...).',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            language: { type: 'string' },
            ast_target: { type: 'object' }
          },
          required: ['path', 'ast_target']
        }
      }
    },
    remember_user: {
      type: 'function',
      function: {
        name: 'remember_user',
        description: 'Store a durable user preference, communication habit, or long-term instruction for future sessions. Use this for things like reply style, language, explanation depth, or stable guardrails. Never store secrets, tokens, passwords, or one-off task details.',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Stable preference or instruction to remember' },
            kind: { type: 'string', description: 'preference, workflow, constraint, or warning' },
            summary: { type: 'string', description: 'Short summary for the memory index' },
            replace_similar: { type: 'boolean', description: 'Replace an existing similar memory when true' }
          },
          required: ['content']
        }
      }
    },
    remember_global: {
      type: 'function',
      function: {
        name: 'remember_global',
        description: 'Store a durable cross-project workflow, environment fact, or generally reusable lesson that can help across many repositories. Use this for stable habits like preferred search tools or repeatable debugging workflow. Never store secrets.',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            kind: { type: 'string' },
            summary: { type: 'string' },
            replace_similar: { type: 'boolean' }
          },
          required: ['content']
        }
      }
    },
    remember_project: {
      type: 'function',
      function: {
        name: 'remember_project',
        description: 'Store a durable project-specific convention, architecture note, key module warning, or local workflow expectation. Use this for repository-specific rules, important files, testing conventions, or architectural boundaries. Never store secrets or transient task state.',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            kind: { type: 'string' },
            summary: { type: 'string' },
            replace_similar: { type: 'boolean' }
          },
          required: ['content']
        }
      }
    },
    list_memory: {
      type: 'function',
      function: {
        name: 'list_memory',
        description: 'List stored persistent memories for one scope.',
        parameters: {
          type: 'object',
          properties: {
            scope: { type: 'string', description: 'user, global, or project' }
          },
          required: ['scope']
        }
      }
    },
    search_memory: {
      type: 'function',
      function: {
        name: 'search_memory',
        description: 'Search stored persistent memories for one scope.',
        parameters: {
          type: 'object',
          properties: {
            scope: { type: 'string', description: 'user, global, or project' },
            query: { type: 'string', description: 'Search phrase' }
          },
          required: ['scope', 'query']
        }
      }
    },
    forget_memory: {
      type: 'function',
      function: {
        name: 'forget_memory',
        description: 'Delete a stored persistent memory by id.',
        parameters: {
          type: 'object',
          properties: {
            scope: { type: 'string', description: 'user, global, or project' },
            id: { type: 'string', description: 'Memory id to delete' }
          },
          required: ['scope', 'id']
        }
      }
    },
    list_background_tasks: {
      type: 'function',
      function: {
        name: 'list_background_tasks',
        description:
          'List background shell tasks started by run(..., run_in_background=true) or auto-backgrounded by run.',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    },
    get_background_task: {
      type: 'function',
      function: {
        name: 'get_background_task',
        description: 'Get the current status for one background shell task.',
        parameters: {
          type: 'object',
          properties: {
            task_id: { type: 'string' }
          },
          required: ['task_id']
        }
      }
    },
    stop_background_task: {
      type: 'function',
      function: {
        name: 'stop_background_task',
        description: 'Stop a running background shell task when it is no longer needed.',
        parameters: {
          type: 'object',
          properties: {
            task_id: { type: 'string' }
          },
          required: ['task_id']
        }
      }
    }
  };

  const definitions = [...primaryDefinitions];

  const handlers = {
    read: async (args) => {
      const inlineQuery = String(args?.query || '').trim();
      const directAstTarget = args?.ast_target;

      if (directAstTarget) {
        const result = await readAstNode(workspaceRoot, {
          ...args,
          path: args?.path || directAstTarget?.path,
          ast_target: directAstTarget
        });
        if (directAstTarget?.path) rememberAstSelection(directAstTarget.path, directAstTarget);
        const readPath = String(result?.path || directAstTarget?.path || '').trim();
        if (readPath) lastReadPath = readPath;
        return result;
      }

      if (inlineQuery) {
        const queryResult = await queryAst(workspaceRoot, args);
        const firstTarget = queryResult?.matches?.[0]?.ast_target;
        if (!firstTarget) {
          return {
            path: String(args?.path || '').trim(),
            language: queryResult?.language,
            query: inlineQuery,
            capture_name: String(args?.capture_name || '').trim() || undefined,
            matches: 0,
            content: ''
          };
        }
        rememberAstSelection(firstTarget.path, firstTarget);
        const result = await readAstNode(workspaceRoot, {
          ...args,
          path: firstTarget.path,
          ast_target: firstTarget
        });
        const readPath = String(result?.path || firstTarget?.path || '').trim();
        if (readPath) lastReadPath = readPath;
        return {
          ...result,
          query: inlineQuery,
          capture_name: String(args?.capture_name || '').trim() || undefined,
          matches: queryResult.matches.length
        };
      }

      const result = await readFile(workspaceRoot, {
        ...args,
        default_lines: config.context?.read_file_default_lines ?? 220,
        max_chars:
          typeof args?.max_chars === 'number'
            ? args.max_chars
            : config.context?.read_file_max_chars ?? 24000
      });
      const readPath = String(result?.path || args?.path || '').trim();
      if (readPath) lastReadPath = readPath;
      return result;
    },
    query_project_index: async (args) => {
      await ensureProjectIndex();
      return queryProjectIndex(workspaceRoot, args);
    },
    grep: (args) => grep(workspaceRoot, args),
    glob: (args) => glob(workspaceRoot, args),
    list: (args) => list(workspaceRoot, args),
    ast_query: async (args) => {
      const result = await queryAst(workspaceRoot, args);
      const firstTarget = result?.matches?.[0]?.ast_target;
      if (firstTarget?.path) rememberAstSelection(firstTarget.path, firstTarget);
      return result;
    },
    read_ast_node: (args) => {
      const astTarget = resolveCachedAstTarget(args);
      if (!astTarget) throw new Error('read_ast_node requires ast_target or a prior ast_query on the same file');
      if (astTarget.path) rememberAstSelection(astTarget.path, astTarget);
      return readAstNode(workspaceRoot, { ...args, ast_target: astTarget });
    },
    edit: async (args) => {
      await ensureProjectIndex();
      const normalizedKind = String(args?.edit?.kind || args?.kind || '').trim();
      const astTarget = resolveCachedAstTarget(args, { requireAstScope: normalizedKind === 'replace_block' });
      const result = await editTarget(
        workspaceRoot,
        astTarget ? { ...args, ast_target: astTarget, recent_file: lastReadPath } : { ...args, recent_file: lastReadPath }
      );
      if (result?.path) await refreshProjectFile(result.path);
      return result;
    },
    write: async (args) => {
      await ensureProjectIndex();
      const result = await writeFile(workspaceRoot, args);
      if (result?.path) await refreshProjectFile(result.path);
      return result;
    },
    delete: Object.assign(async (args) => {
      await ensureProjectIndex();
      const result = await deletePath(workspaceRoot, args);
      if (result?.path) await refreshProjectFile(result.path);
      return result;
    }, {
      prepareApproval: async (args) => {
        const target = await prepareDeleteTarget(workspaceRoot, args);
        return {
          path: target.path,
          name: target.name,
          type: target.type
        };
      }
    }),
    update_todos: async (args = {}) => {
      const oldTodos = normalizeTodos(typeof getTodos === 'function' ? getTodos() : []);
      const nextTodos = normalizeTodos(args?.todos);
      if (typeof onTodosUpdate === 'function') {
        onTodosUpdate(nextTodos);
      }
      return {
        ok: true,
        oldTodos,
        newTodos: nextTodos
      };
    },
    run: (args) => runCommand(workspaceRoot, config, args),
    remember_user: async (args = {}) => {
      const saved = await rememberMemory({
        scope: 'user',
        content: args.content,
        kind: args.kind,
        summary: args.summary,
        replaceSimilar: args.replace_similar !== false,
        workspaceRoot,
        config
      });
      return { ok: true, scope: 'user', memory: saved };
    },
    remember_global: async (args = {}) => {
      const saved = await rememberMemory({
        scope: 'global',
        content: args.content,
        kind: args.kind,
        summary: args.summary,
        replaceSimilar: args.replace_similar !== false,
        workspaceRoot,
        config
      });
      return { ok: true, scope: 'global', memory: saved };
    },
    remember_project: async (args = {}) => {
      const saved = await rememberMemory({
        scope: 'project',
        content: args.content,
        kind: args.kind,
        summary: args.summary,
        replaceSimilar: args.replace_similar !== false,
        workspaceRoot,
        config
      });
      return { ok: true, scope: 'project', memory: saved };
    },
    list_memory: async (args = {}) => ({
      scope: String(args.scope || ''),
      items: await listMemories({ scope: args.scope, workspaceRoot })
    }),
    search_memory: async (args = {}) => ({
      scope: String(args.scope || ''),
      query: String(args.query || ''),
      items: await searchMemories({ scope: args.scope, query: args.query, workspaceRoot })
    }),
    forget_memory: async (args = {}) => ({
      ok: true,
      ...(await forgetMemory({ scope: args.scope, id: args.id, workspaceRoot }))
    }),
    list_background_tasks: () => listBackgroundTasks(workspaceRoot),
    get_background_task: (args) => getBackgroundTask(workspaceRoot, args),
    stop_background_task: (args) => stopBackgroundTask(workspaceRoot, args),
    tool_search: (args) => {
      const query = String(args?.query || '').trim().toLowerCase();
      if (query === 'all') {
        const all = Object.values(deferredDefinitions);
        return {
          loaded: Object.keys(deferredDefinitions),
          schemas: all,
          message: `Loaded all ${all.length} deferred tools. You can now call them directly.`
        };
      }
      const match = Object.entries(deferredDefinitions).find(([name]) => name === query);
      if (!match) {
        const available = Object.keys(deferredDefinitions).join(', ');
        return { error: `Unknown tool: "${query}". Available deferred tools: ${available}` };
      }
      return {
        loaded: [match[0]],
        schemas: [match[1]],
        message: `Loaded tool "${match[0]}". You can now call it in your next response.`
      };
    }
  };

  const formatters = {
    read(result) {
      if (typeof result === 'string') return result;
      if (!result || typeof result !== 'object') return String(result);
      if (result.node && typeof result.content === 'string') {
        const header = `[AST: ${result.path || '?'} ${result.node.node_type || 'node'} ${result.node.start_line || '?'}-${result.node.end_line || '?'}${result.matches ? `, matches ${result.matches}` : ''}]`;
        return `${header}\n${result.content}`;
      }
      // Phase 1 metadata: small, return as-is
      if (result.phase === 'metadata') {
        return JSON.stringify(result);
      }
      // Phase 2 content: structured header + head/tail content
      if (result.phase === 'content') {
        const enclosing = result.enclosing_symbol ? `, inside ${result.enclosing_kind || 'symbol'} ${result.enclosing_symbol}` : '';
        const header = `[File: ${result.path}, lines ${result.start_line || 1}-${result.end_line || '?'}${result.total_lines ? ` of ${result.total_lines}` : ''}${result.truncated ? ', truncated' : ''}${enclosing}]`;
        const content = result.content || '';
        if (typeof content !== 'string' || content.length <= 3000) {
          return `${header}\n${content}`;
        }
        const headLen = 1800;
        const tailLen = 800;
        return `${header}\n${content.slice(0, headLen)}\n... [omitted ${content.length - headLen - tailLen} chars] ...\n${content.slice(-tailLen)}`;
      }
      return JSON.stringify(result);
    },

    grep(result) {
      if (!result || typeof result !== 'object') return String(result);
      const { pattern, matches, truncated } = result;
      const header = pattern ? `[grep: "${pattern}"]` : '';
      if (!Array.isArray(matches) || matches.length === 0) return `${header}\nNo matches found.`;
      if (matches.length <= 30) {
        const lines = matches.map((m) => `${m.path}:${m.line}: ${String(m.preview || '').slice(0, 120)}`);
        return `${header}\n${lines.join('\n')}`;
      }
      const shown = matches.slice(0, 30).map((m) => `${m.path}:${m.line}: ${String(m.preview || '').slice(0, 120)}`);
      return `${header}\n${shown.join('\n')}\n... and ${matches.length - 30} more matches [total: ${matches.length}${truncated ? ', results were truncated' : ''}]`;
    },

    glob(result) {
      if (!result || typeof result !== 'object') return String(result);
      const { pattern, matches, truncated } = result;
      const header = pattern ? `[glob: "${pattern}"]` : '';
      if (!Array.isArray(matches) || matches.length === 0) return `${header}\nNo files found.`;
      if (matches.length <= 50) {
        return `${header}\n${matches.join('\n')}`;
      }
      const shown = matches.slice(0, 50);
      return `${header}\n${shown.join('\n')}\n... and ${matches.length - 50} more files [total: ${matches.length}${truncated ? ', results were truncated' : ''}]`;
    },

    list(result) {
      if (!result || typeof result !== 'object') return String(result);
      if (!Array.isArray(result.items)) return JSON.stringify(result);
      const header = result.path ? `[${result.path}]` : '';
      const dirs = result.items.filter((i) => i.type === 'dir').map((i) => `${i.name}/`);
      const files = result.items.filter((i) => i.type === 'file').map((i) => i.name);
      return `${header}\n${dirs.join('\n')}${dirs.length && files.length ? '\n' : ''}${files.join('\n')}`;
    },

    update_todos(result) {
      if (!result || typeof result !== 'object') return String(result);
      const nextTodos = normalizeTodos(result.newTodos);
      if (nextTodos.length === 0) return 'Todo list cleared.';
      const lines = nextTodos.map((item) => {
        const box = item.status === 'completed' ? '[x]' : item.status === 'in_progress' ? '[~]' : '[ ]';
        return `${box} ${item.content}`;
      });
      return ['Updated todo list:', ...lines].join('\n');
    },

    query_project_index(result) {
      if (!result || typeof result !== 'object') return String(result);
      const lines = [];
      if (result.query) lines.push(`[project_index: "${result.query}"]`);
      if (result.project_root) lines.push(`project_root: ${result.project_root}`);
      const projectMap = result.project_map;
      if (projectMap) {
        lines.push(`languages: ${(projectMap.languages || []).join(', ') || 'unknown'}`);
        lines.push(`source_roots: ${(projectMap.source_roots || []).join(', ') || 'none'}`);
        lines.push(`test_roots: ${(projectMap.test_roots || []).join(', ') || 'none'}`);
        lines.push(`entry_candidates: ${(projectMap.entry_candidates || []).join(', ') || 'none'}`);
        lines.push(`framework_hints: ${(projectMap.framework_hints || []).join(', ') || 'none'}`);
      }
      const matches = Array.isArray(result.matches) ? result.matches : [];
      if (matches.length === 0) {
        lines.push('No indexed file matches found.');
        return lines.join('\n');
      }
      lines.push('matches:');
      for (const item of matches) {
        lines.push(
          `- ${item.file} [score=${item.score}] exports=[${(item.exports || []).join(', ')}] functions=[${(item.functions || []).join(', ')}] classes=[${(item.classes || []).join(', ')}]`
        );
      }
      return lines.join('\n');
    },

    edit(result) {
      if (!result || typeof result !== 'object') return String(result);
      const p = result.path || '';
      const action = result.action || '';
      const line = result.changed_line || 0;
      const summary = `${action} ${p}${line > 0 ? ` @L${line}` : ''}`;
      const diffPreview = result.diff_preview || '';
      if (diffPreview) {
        const trimmed = diffPreview.length > 600 ? `${diffPreview.slice(0, 597)}...` : diffPreview;
        return `${summary}\n${trimmed}`;
      }
      return summary + (result.ok !== false ? '' : ` [FAILED: ${result.error || 'unknown'}]`);
    },

    write(result) {
      if (!result || typeof result !== 'object') return String(result);
      const p = result.path || '';
      const action = result.action || 'write';
      const line = result.changed_line || 0;
      const summary = `${action} ${p}${line > 0 ? ` @L${line}` : ''}`;
      const diffPreview = result.diff_preview || '';
      if (diffPreview) {
        const trimmed = diffPreview.length > 600 ? `${diffPreview.slice(0, 597)}...` : diffPreview;
        return `${summary}\n${trimmed}`;
      }
      return summary;
    },

    delete(result) {
      if (!result || typeof result !== 'object') return String(result);
      if (result.ok === false) return JSON.stringify(result);
      const kind = result.type || 'item';
      const target = result.path || '';
      return `[delete: ${kind}] deleted ${target}`;
    },

    run(result) {
      if (!result || typeof result !== 'object') return String(result);
      if (result.background) {
        const parts = [
          `[background task: ${result.task_id || '?'}]`,
          `status: ${result.status || 'running'}`
        ];
        if (result.command) parts.push(`command: ${String(result.command).slice(0, 200)}`);
        if (result.output_file) parts.push(`output_file: ${result.output_file}`);
        if (Array.isArray(result.recent_output) && result.recent_output.length > 0) {
          parts.push(`recent_output:\n${result.recent_output.slice(0, 6).join('\n')}`);
        }
        return parts.join('\n');
      }
      const command = String(result.command || '').slice(0, 200);
      const stdout = String(result.stdout || '').slice(0, 500);
      const stderr = String(result.stderr || '').slice(0, 500);
      const code = result.code ?? 0;
      const parts = [`[exit: ${code}]`];
      if (command) parts.push(`command: ${command}`);
      if (stdout) parts.push(`stdout:\n${stdout}`);
      if (stderr) parts.push(`stderr:\n${stderr}`);
      return parts.join('\n');
    },

    remember_user(result) {
      return result?.memory?.content ? `stored user memory: ${result.memory.content}` : JSON.stringify(result);
    },

    remember_global(result) {
      return result?.memory?.content ? `stored global memory: ${result.memory.content}` : JSON.stringify(result);
    },

    remember_project(result) {
      return result?.memory?.content ? `stored project memory: ${result.memory.content}` : JSON.stringify(result);
    },

    list_memory(result) {
      if (!result || typeof result !== 'object' || !Array.isArray(result.items)) return JSON.stringify(result);
      if (result.items.length === 0) return `No ${result.scope || ''} memories found.`;
      return result.items.map((item) => `${item.id} [${item.kind}] ${item.content}`).join('\n');
    },

    search_memory(result) {
      if (!result || typeof result !== 'object' || !Array.isArray(result.items)) return JSON.stringify(result);
      if (result.items.length === 0) return `No ${result.scope || ''} memories matched "${result.query || ''}".`;
      return result.items.map((item) => `${item.id} [${item.kind}] ${item.content}`).join('\n');
    },

    forget_memory(result) {
      return `removed ${Number(result?.removed || 0)} memory item(s)`;
    },

    ast_query(result) {
      if (!result || typeof result !== 'object') return String(result);
      if (!Array.isArray(result.matches)) return JSON.stringify(result);
      const header = `[ast_query: ${result.matches.length} match(es)]`;
      const lines = result.matches.slice(0, 20).map((m) => {
        const name = m.name || m.ast_target?.name || '?';
        const kind = m.kind || m.ast_target?.kind || '?';
        return `  ${kind} ${name}`;
      });
      return `${header}\n${lines.join('\n')}${result.matches.length > 20 ? `\n... +${result.matches.length - 20} more` : ''}`;
    },

    read_ast_node(result) {
      if (typeof result === 'string') return result;
      if (!result || typeof result !== 'object') return String(result);
      const name = result.name || '';
      const kind = result.kind || '';
      const content = result.content || result.source || '';
      const header = `${kind} ${name}`;
      if (typeof content !== 'string' || content.length <= 2000) return `${header}\n${content}`;
      return `${header}\n${content.slice(0, 1200)}\n... [omitted ${content.length - 1600} chars] ...\n${content.slice(-400)}`;
    },

    list_background_tasks(result) {
      if (!result || typeof result !== 'object') return String(result);
      if (!Array.isArray(result.tasks)) return JSON.stringify(result);
      if (result.tasks.length === 0) return 'No background tasks running.';
      return result.tasks.map((task) => `${task.task_id || '?'} ${task.status || 'unknown'}${task.command ? ` (${task.command.slice(0, 60)})` : ''}`).join('\n');
    },

    get_background_task(result) {
      if (!result || typeof result !== 'object') return String(result);
      const tid = result.task_id || '';
      const status = result.status || 'unknown';
      const outputFile = result.output_file || '';
      const output = Array.isArray(result.recent_output) ? result.recent_output.slice(-3).join('\n') : '';
      return `${tid} ${status}${outputFile ? ` -> ${outputFile}` : ''}${output ? `\n${output}` : ''}`;
    },

    stop_background_task(result) {
      if (!result || typeof result !== 'object') return String(result);
      return `${result.task_id || '?'} stopped${result.exit_code != null ? ` (exit ${result.exit_code})` : ''}`;
    }
  };

  return { definitions, handlers, formatters, deferredDefinitions };
}
