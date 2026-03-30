import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import net from 'node:net';
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
import { queryAst, readAstNode, resolveAstTarget } from './ast.js';

const SKIP_DIRS = new Set(['.git', 'node_modules', '.coder', '.codemini-cli', 'dist', 'coverage']);
const TEXT_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.json',
  '.md',
  '.mjs',
  '.cjs',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.cs',
  '.css',
  '.scss',
  '.html',
  '.yml',
  '.yaml',
  '.sh',
  '.ps1'
]);
const CODE_WRITE_GUARD_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.cs',
  '.css',
  '.scss',
  '.html',
  '.sh',
  '.ps1'
]);
const LANGUAGE_FILE_TYPES = {
  js: ['js', 'jsx', 'mjs', 'cjs'],
  ts: ['ts', 'tsx'],
  py: ['py'],
  python: ['py'],
  md: ['md'],
  json: ['json'],
  css: ['css', 'scss'],
  html: ['html'],
  java: ['java'],
  csharp: ['cs'],
  cs: ['cs'],
  go: ['go'],
  rust: ['rs'],
  ruby: ['rb'],
  shell: ['sh', 'ps1'],
  yaml: ['yml', 'yaml']
};
const SERVICE_RECENT_LOG_LIMIT = 80;
const SERVICE_STARTUP_POLL_MS = 150;
const serviceRegistry = new Map();
let serviceCounter = 0;
let serviceLogCursorCounter = 0;

function resolveInWorkspace(root, targetPath = '.') {
  const absRoot = path.resolve(root);
  const absTarget = path.resolve(absRoot, targetPath);
  if (!absTarget.startsWith(absRoot)) {
    throw new Error(`Path escapes workspace: ${targetPath}`);
  }
  return absTarget;
}

function toWorkspaceRelative(root, absPath) {
  return path.relative(path.resolve(root), absPath).replace(/\\/g, '/');
}

function sha256(input) {
  return `sha256:${crypto.createHash('sha256').update(String(input || '')).digest('hex')}`;
}

function sha1(input) {
  return crypto.createHash('sha1').update(String(input || '')).digest('hex');
}

function trimLinePreview(line, maxLen = 180) {
  const text = String(line || '').replace(/\t/g, '  ').trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 3)}...`;
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitLines(text) {
  return String(text || '').split('\n');
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

async function walkTextFiles(root, startPath = '.', fileTypes = []) {
  const abs = resolveInWorkspace(root, startPath);
  const out = [];
  const allowedExts = new Set((Array.isArray(fileTypes) ? fileTypes : []).map((item) => `.${String(item || '').replace(/^\./, '')}`));

  async function visit(current) {
    const stat = await fs.stat(current);
    if (stat.isDirectory()) {
      const name = path.basename(current);
      if (SKIP_DIRS.has(name)) return;
      const entries = await fs.readdir(current);
      for (const entry of entries) {
        await visit(path.join(current, entry));
      }
      return;
    }
    if (!detectTextFile(current)) return;
    if (allowedExts.size > 0 && !allowedExts.has(path.extname(current).toLowerCase())) return;
    out.push(current);
  }

  await visit(abs);
  return out;
}

async function walkWorkspaceEntries(root, startPath = '.', { includeHidden = false } = {}) {
  const abs = resolveInWorkspace(root, startPath);
  const out = [];

  async function visit(current) {
    const stat = await fs.stat(current);
    const relative = toWorkspaceRelative(root, current) || '.';
    const name = path.basename(current);

    if (!includeHidden && name.startsWith('.') && relative !== '.') return;
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(name) && relative !== '.') return;
      out.push({ path: relative, name, type: 'dir' });
      const entries = await fs.readdir(current);
      for (const entry of entries) {
        await visit(path.join(current, entry));
      }
      return;
    }

    out.push({ path: relative, name, type: 'file' });
  }

  await visit(abs);
  return out;
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

function getLineColumnForMatch(line, query, caseSensitive = false) {
  const haystack = caseSensitive ? line : line.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const index = haystack.indexOf(needle);
  return index === -1 ? 1 : index + 1;
}

function classifyMatch(preview, query) {
  const line = String(preview || '');
  const escaped = escapeRegex(query);
  const normalized = line.toLowerCase();
  const queryLower = String(query || '').toLowerCase();
  const definitionLeadPatterns = [
    /^\s*(?:export\s+)?(?:async\s+)?function\b/i,
    /^\s*(?:export\s+)?class\b/i,
    /^\s*(?:export\s+)?(?:const|let|var)\b/i,
    /^\s*(?:export\s+)?(?:interface|type|enum)\b/i,
    /^\s*def\b/i,
    /^\s*(?:public|private|protected)\s+[A-Za-z0-9_<>,[\]\s?]+\s+[A-Za-z0-9_$]+\s*\(/i
  ];
  if (definitionLeadPatterns.some((pattern) => pattern.test(line)) && normalized.includes(queryLower)) {
    return 'definition';
  }
  if (new RegExp(String.raw`\b${escaped}\s*\(`, 'i').test(line)) return 'reference';
  return 'text';
}

function matchSpecificity(preview, query) {
  const line = String(preview || '');
  const escaped = escapeRegex(query);
  if (new RegExp(String.raw`\b${escaped}\b`, 'i').test(line)) return 0;
  if (line.toLowerCase().includes(String(query || '').toLowerCase())) return 1;
  return 2;
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
    const blockLine = findEnclosingSymbol(lines, i + 1);
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

function findEnclosingSymbol(lines, anchorLine) {
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

function parseUnifiedPatch(patchText) {
  const lines = splitLines(String(patchText || ''));
  const files = [];
  let current = null;

  const pushCurrent = () => {
    if (current) files.push(current);
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith('--- ')) {
      pushCurrent();
      current = {
        oldPath: line.slice(4).trim(),
        newPath: '',
        hunks: []
      };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('+++ ')) {
      current.newPath = line.slice(4).trim();
      continue;
    }
    if (line.startsWith('@@ ')) {
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (!match) {
        throw new Error(`invalid patch hunk header: ${line}`);
      }
      const hunk = {
        oldStart: Number(match[1]),
        oldCount: Number(match[2] || '1'),
        newStart: Number(match[3]),
        newCount: Number(match[4] || '1'),
        lines: []
      };
      i += 1;
      while (i < lines.length) {
        const hunkLine = lines[i];
        if (hunkLine.startsWith('@@ ') || hunkLine.startsWith('--- ')) {
          i -= 1;
          break;
        }
        if (hunkLine.startsWith('\\ No newline at end of file')) {
          i += 1;
          continue;
        }
        if (hunkLine === '') {
          hunk.lines.push(' ');
          i += 1;
          continue;
        }
        if (!/^[ +\-]/.test(hunkLine)) {
          hunk.lines.push(` ${hunkLine}`);
          i += 1;
          continue;
        }
        if (!/^[ +\-]/.test(hunkLine)) {
          throw new Error(`invalid patch line: ${hunkLine}`);
        }
        hunk.lines.push(hunkLine);
        i += 1;
      }
      current.hunks.push(hunk);
    }
  }

  pushCurrent();
  return files.filter((file) => file.oldPath || file.newPath);
}

function applyHunkToLines(lines, hunk) {
  const oldChunk = [];
  const newChunk = [];
  for (const line of hunk.lines) {
    if (line.startsWith(' ')) {
      const text = line.slice(1);
      oldChunk.push(text);
      newChunk.push(text);
      continue;
    }
    if (line.startsWith('-')) {
      oldChunk.push(line.slice(1));
      continue;
    }
    if (line.startsWith('+')) {
      newChunk.push(line.slice(1));
    }
  }

  if (oldChunk.length === 0) {
    const insertAt = Math.max(0, Number(hunk.oldStart || 1) - 1);
    return [...lines.slice(0, insertAt), ...newChunk, ...lines.slice(insertAt)];
  }

  const lastStart = Math.max(0, lines.length - oldChunk.length);
  const matches = [];
  for (let start = 0; start <= lastStart; start += 1) {
    let ok = true;
    for (let offset = 0; offset < oldChunk.length; offset += 1) {
      if (lines[start + offset] !== oldChunk[offset]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      matches.push(start);
      if (matches.length > 1) break;
    }
  }

  if (matches.length === 0) {
    throw new Error('patch hunk context not found');
  }
  if (matches.length > 1) {
    throw new Error('patch hunk context not unique');
  }

  const start = matches[0];
  return [...lines.slice(0, start), ...newChunk, ...lines.slice(start + oldChunk.length)];
}

async function getFileState(root, relativePath) {
  const target = resolveInWorkspace(root, relativePath);
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
  const target = resolveInWorkspace(root, args?.path);
  const stat = await fs.stat(target);
  const text = await fs.readFile(target, 'utf8');
  const lines = splitLines(text);
  const totalLines = lines.length;
  const startLineRaw = Number(args?.start_line);
  const endLineRaw = Number(args?.end_line);
  const defaultLines = Number(args?.default_lines || 220);
  const maxChars = Number(args?.max_chars || 24000);
  const includeContent = Boolean(args?.include_content);

  let startLine = Number.isFinite(startLineRaw) && startLineRaw > 0 ? startLineRaw : 1;
  let endLine =
    Number.isFinite(endLineRaw) && endLineRaw >= startLine
      ? endLineRaw
      : Math.min(totalLines, startLine + Math.max(1, defaultLines) - 1);
  startLine = Math.max(1, Math.min(startLine, totalLines));
  endLine = Math.max(startLine, Math.min(endLine, totalLines));

  const tokenSeed = `${args?.path}|${stat.size}|${stat.mtimeMs}|${startLine}|${endLine}`;
  const readToken = sha1(tokenSeed).slice(0, 16);

  if (!includeContent) {
    return {
      path: args?.path,
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

  if (String(args?.read_token || '') !== readToken) {
    return {
      path: args?.path,
      phase: 'metadata',
      error: 'read_token mismatch or missing',
      size_bytes: stat.size,
      modified_at: new Date(stat.mtimeMs).toISOString(),
      total_lines: totalLines,
      suggested_start_line: startLine,
      suggested_end_line: endLine,
      read_token: readToken,
      next: 'Retry with include_content=true and read_token from latest metadata'
    };
  }

  let content = lines.slice(startLine - 1, endLine).join('\n');
  let truncated = false;
  if (maxChars > 0 && content.length > maxChars) {
    content = `${content.slice(0, maxChars)}\n... [truncated by max_chars]`;
    truncated = true;
  }

  return {
    path: args?.path,
    phase: 'content',
    start_line: startLine,
    end_line: endLine,
    total_lines: totalLines,
    truncated,
    content
  };
}

async function writeFile(root, args) {
  const rawPath = String(args?.path || '').trim();
  if (!rawPath) {
    throw new Error('write requires a file path like weather/WeatherForecast.js');
  }
  if (rawPath === '.' || rawPath === './') {
    throw new Error('write requires a file path, not the workspace root');
  }
  const target = resolveInWorkspace(root, rawPath);
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
  if (existed && !args?.append && !args?.full_file_rewrite && isCodeLikePath(rawPath)) {
    throw new Error(
      'write blocks full overwrite for existing code files by default. Use grep/read -> edit for minimal edits, or pass full_file_rewrite=true when a whole-file rewrite is truly intended.'
    );
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (args?.append) {
    await fs.appendFile(target, args?.content || '', 'utf8');
  } else {
    await fs.writeFile(target, args?.content || '', 'utf8');
  }
  const after = args?.append ? `${before}${args?.content || ''}` : args?.content || '';
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
    action: args?.append ? 'append' : existed ? 'overwrite' : 'create',
    changed_line: changeLine || Math.max(1, afterLines.length),
    diff_preview: previewLines.map((line, idx) => `${previewStart + idx + 1}| ${line}`).join('\n')
  };
}

async function runCommand(root, config, args) {
  const command = args?.command || '';
  if (!command.trim()) {
    throw new Error('run requires command');
  }
  if (isLikelyLongRunningCommand(command)) {
    const intent = classifyCommandIntent(command);
    const labelMap = {
      'frontend-service': 'frontend service',
      'backend-service': 'backend service',
      'database-service': 'database service',
      'docker-service': 'Docker service',
      service: 'long-running service'
    };
    const label = labelMap[intent.kind] || 'long-running service';
    throw new Error(`Command looks like a ${label}. Use start_service instead of run.`);
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

  const result = await runShellCommand({
    command,
    cwd: root,
    shell: config.shell.default,
    timeoutMs: config.shell.timeout_ms
  });
  return { ...result, command };
}

function nextServiceId() {
  serviceCounter += 1;
  return `svc_${String(serviceCounter).padStart(3, '0')}`;
}

function normalizeSuccessMatchers(items = []) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => String(item || '').trim()).filter(Boolean);
}

function shellCommandForService(command, shellSpec) {
  return process.platform !== 'win32' && /(?:^|\/)bash(?:\.exe)?$/i.test(shellSpec.command)
    ? `exec ${command}`
    : command;
}

function appendRecentLogs(service, chunk) {
  const lines = String(chunk || '')
    .split(/\r?\n/)
    .map((line) => trimLinePreview(line, 220))
    .filter(Boolean);
  if (lines.length === 0) return;
  for (const line of lines) {
    serviceLogCursorCounter += 1;
    service.recentLogs.push({ cursor: serviceLogCursorCounter, line });
  }
  if (service.recentLogs.length > SERVICE_RECENT_LOG_LIMIT) {
    service.recentLogs.splice(0, service.recentLogs.length - SERVICE_RECENT_LOG_LIMIT);
  }
}

function matchesServiceSuccess(service, text) {
  const value = String(text || '');
  if (!value) return false;
  if (hasReadyOutput(value)) return true;
  return service.successMatchers.some((matcher) => value.toLowerCase().includes(matcher.toLowerCase()));
}

function markServiceReady(service, source = 'output') {
  if (service.startupConfirmed) return;
  service.startupConfirmed = true;
  service.startupSource = source;
  service.status = 'running';
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

function snapshotService(service, tail = 12) {
  const recentLogs = Array.isArray(service.recentLogs)
    ? service.recentLogs.slice(-Math.max(1, tail)).map((item) => item.line)
    : [];
  const latestCursor =
    Array.isArray(service.recentLogs) && service.recentLogs.length > 0
      ? service.recentLogs[service.recentLogs.length - 1].cursor
      : 0;
  return {
    task_id: service.taskId,
    pid: service.child?.pid || null,
    command: service.command,
    cwd: service.cwd,
    status: service.status,
    startup_confirmed: service.startupConfirmed,
    startup_source: service.startupSource || '',
    http_probe: service.httpProbe || undefined,
    url: serviceUrlForPort(service.portProbe) || undefined,
    recent_logs: recentLogs,
    log_cursor: latestCursor,
    exit_code: service.exitCode ?? undefined,
    signal: service.signal ?? undefined,
    duration_ms: Date.now() - service.startedAt
  };
}

function listServiceSnapshots() {
  return Array.from(serviceRegistry.values()).map((service) => snapshotService(service, 4));
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

async function startService(root, config, args) {
  const command = String(args?.command || args?.cmd || '').trim();
  if (!command) throw new Error('start_service requires command');
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
  const taskId = nextServiceId();
  const startupTimeoutMs = Math.max(250, Number(args?.startup_timeout_ms || args?.startupTimeoutMs || 20000));
  const successMatchers = normalizeSuccessMatchers(args?.success_matchers || args?.successMatchers);
  const portProbe = Number(args?.port_probe || args?.portProbe || 0) || 0;
  const httpProbe = normalizeHttpProbe(args?.http_probe || args?.httpProbe);
  const service = {
    taskId,
    command,
    cwd: root,
    child: spawn(shellSpec.command, [...shellSpec.args, shellCommandForService(command, shellSpec)], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe']
    }),
    startedAt: Date.now(),
    status: 'starting',
    startupConfirmed: false,
    startupSource: '',
    successMatchers,
    portProbe,
    httpProbe,
    recentLogs: [],
    exitCode: null,
    signal: null
  };
  serviceRegistry.set(taskId, service);

  service.closePromise = new Promise((resolve) => {
    service.child.on('close', (code, signal) => {
      service.exitCode = code;
      service.signal = signal;
      service.status = service.status === 'stopped' ? 'stopped' : 'exited';
      resolve();
    });
  });

  const onOutput = (chunk) => {
    appendRecentLogs(service, chunk);
    if (matchesServiceSuccess(service, chunk)) {
      markServiceReady(service, 'output');
      if (service._finishStartup) service._finishStartup();
    }
  };
  service.child.stdout.on('data', onOutput);
  service.child.stderr.on('data', onOutput);
  service.child.on('error', (error) => {
    appendRecentLogs(service, error?.message || String(error));
    service.status = 'exited';
    if (service._finishStartup) service._finishStartup();
  });

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      clearInterval(portHandle);
      clearInterval(httpHandle);
      service._finishStartup = null;
      resolve();
    };
    service._finishStartup = finish;
    if (service.startupConfirmed || service.status === 'exited') {
      finish();
      return;
    }
    const timeoutHandle = setTimeout(() => {
      if (service.status === 'starting') {
        if (!service.startupConfirmed) {
          markServiceReady(service, 'startup_window');
        } else {
          service.status = 'running';
        }
      }
      finish();
    }, startupTimeoutMs);
    const portHandle =
      portProbe > 0
        ? setInterval(async () => {
            const open = await probePortOnce(portProbe);
            if (open) {
              markServiceReady(service, 'port_probe');
              finish();
            }
          }, SERVICE_STARTUP_POLL_MS)
        : null;
    const httpHandle =
      httpProbe
        ? setInterval(async () => {
            const ok = await probeHttpOnce(httpProbe);
            if (ok) {
              markServiceReady(service, 'http_probe');
              finish();
            }
          }, SERVICE_STARTUP_POLL_MS)
        : null;
    service.child.once('close', () => finish());
  });

  if (service.status === 'starting') {
    service.status = 'running';
  }
  return snapshotService(service);
}

function getServiceOrThrow(taskId) {
  const service = serviceRegistry.get(String(taskId || '').trim());
  if (!service) throw new Error(`Unknown service task: ${taskId}`);
  return service;
}

async function getServiceStatus(_root, args) {
  const service = getServiceOrThrow(args?.task_id || args?.taskId);
  return snapshotService(service);
}

async function listServices() {
  return {
    services: listServiceSnapshots()
  };
}

async function getServiceLogs(_root, args) {
  const service = getServiceOrThrow(args?.task_id || args?.taskId);
  const tail = Math.max(1, Math.min(200, Number(args?.tail || 40)));
  const afterCursor = Math.max(0, Number(args?.after_cursor || args?.afterCursor || 0));
  const filtered = afterCursor > 0 ? service.recentLogs.filter((item) => item.cursor > afterCursor) : service.recentLogs;
  const selected = filtered.slice(-tail);
  return {
    task_id: service.taskId,
    status: service.status,
    recent_logs: selected.map((item) => item.line),
    next_cursor: selected.length > 0 ? selected[selected.length - 1].cursor : afterCursor
  };
}

async function stopService(_root, args) {
  const service = getServiceOrThrow(args?.task_id || args?.taskId);
  if (service.status === 'stopped' || service.status === 'exited') {
    return { ...snapshotService(service), stopped: true };
  }
  service.status = 'stopped';
  terminateChild(service.child, 'SIGTERM');
  setTimeout(() => terminateChild(service.child, 'SIGKILL'), 200);
  await Promise.race([
    service.closePromise,
    new Promise((resolve) => setTimeout(resolve, 500))
  ]);
  return { ...snapshotService(service), stopped: true };
}

async function searchCode(root, args) {
  const query = String(args?.query || args?.symbol || '').trim();
  if (!query) throw new Error('search_code requires query');
  const maxResults = Math.max(1, Math.min(50, Number(args?.max_results || 12)));
  const caseSensitive = Boolean(args?.case_sensitive);
  const files = await walkTextFiles(root, args?.path || '.', normalizeFileTypes(args));
  const matches = [];

  for (const filePath of files) {
    const content = await fs.readFile(filePath, 'utf8');
    const lines = splitLines(content);
    for (let idx = 0; idx < lines.length; idx += 1) {
      const line = lines[idx];
      const haystack = caseSensitive ? line : line.toLowerCase();
      const needle = caseSensitive ? query : query.toLowerCase();
      if (!haystack.includes(needle)) continue;
      matches.push({
        file: toWorkspaceRelative(root, filePath),
        line: idx + 1,
        column: getLineColumnForMatch(line, query, caseSensitive),
        preview: trimLinePreview(line),
        kind: classifyMatch(line, query),
        symbolHint: query
      });
      if (matches.length >= maxResults) {
        matches.sort((left, right) => {
          const kindRank = { definition: 0, reference: 1, text: 2 };
          const specificity = matchSpecificity(left.preview, query) - matchSpecificity(right.preview, query);
          if (specificity !== 0) return specificity;
          if (kindRank[left.kind] !== kindRank[right.kind]) return kindRank[left.kind] - kindRank[right.kind];
          return left.file.localeCompare(right.file) || left.line - right.line;
        });
        return {
          query,
          matches,
          definitions: matches.filter((item) => item.kind === 'definition'),
          references: matches.filter((item) => item.kind === 'reference'),
          text_matches: matches.filter((item) => item.kind === 'text'),
          truncated: true
        };
      }
    }
  }

  matches.sort((left, right) => {
    const kindRank = { definition: 0, reference: 1, text: 2 };
    const specificity = matchSpecificity(left.preview, query) - matchSpecificity(right.preview, query);
    if (specificity !== 0) return specificity;
    if (kindRank[left.kind] !== kindRank[right.kind]) return kindRank[left.kind] - kindRank[right.kind];
    return left.file.localeCompare(right.file) || left.line - right.line;
  });

  return {
    query,
    matches,
    definitions: matches.filter((item) => item.kind === 'definition'),
    references: matches.filter((item) => item.kind === 'reference'),
    text_matches: matches.filter((item) => item.kind === 'text'),
    truncated: false
  };
}

async function grep(root, args) {
  const pattern = String(args?.pattern || args?.query || '').trim();
  if (!pattern) throw new Error('grep requires pattern');
  const maxResults = Math.max(1, Math.min(200, Number(args?.max_results || 50)));
  const caseSensitive = Boolean(args?.case_sensitive);
  const files = await walkTextFiles(root, args?.path || '.', normalizeFileTypes(args));
  const regex = args?.regex
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
  const pattern = String(args?.pattern || '').trim();
  if (!pattern) throw new Error('glob requires pattern');
  const maxResults = Math.max(1, Math.min(500, Number(args?.max_results || 200)));
  const regex = globToRegex(pattern);
  const entries = await walkWorkspaceEntries(root, args?.path || '.', {
    includeHidden: Boolean(args?.include_hidden)
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
  const relativePath = String(args?.path || '.').trim() || '.';
  const target = resolveInWorkspace(root, relativePath);
  const entries = await fs.readdir(target, { withFileTypes: true });
  const includeHidden = Boolean(args?.include_hidden);
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

async function generateDiff(root, args) {
  const relativePath = String(args?.path || '').trim();
  if (!relativePath) throw new Error('generate_diff requires path');
  const state = await getFileState(root, relativePath);
  const newContent = String(args?.new_content || '');
  return {
    path: relativePath,
    old_hash: sha256(state.content),
    new_hash: sha256(newContent),
    diff: buildUnifiedDiff(state.content, newContent, relativePath)
  };
}

async function applyPatch(root, args) {
  const patchText = String(args?.patch || args?.content || '').trim();
  if (!patchText) throw new Error('patch requires patch content');
  const files = parseUnifiedPatch(patchText);
  if (files.length === 0) throw new Error('patch contains no file changes');

  const results = [];
  for (const fileChange of files) {
    const newPath = String(fileChange.newPath || '').trim();
    const oldPath = String(fileChange.oldPath || '').trim();
    const targetPath = newPath && newPath !== '/dev/null' ? newPath : oldPath;
    if (!targetPath || targetPath === '/dev/null') {
      throw new Error('patch requires a target file path');
    }
    const absTarget = resolveInWorkspace(root, targetPath);
    let beforeContent = '';
    let beforeLines = [];
    try {
      beforeContent = await fs.readFile(absTarget, 'utf8');
      beforeLines = splitLines(beforeContent);
    } catch (error) {
      if (!(error && error.code === 'ENOENT')) throw error;
    }

    let nextLines = beforeLines;
    for (const hunk of fileChange.hunks) {
      nextLines = applyHunkToLines(nextLines, hunk);
    }
    const afterContent = nextLines.join('\n');

    if (newPath === '/dev/null') {
      await fs.rm(absTarget, { force: true });
      results.push({
        path: targetPath,
        action: 'delete',
        changed_line: 1,
        diff_preview: `deleted ${targetPath}`,
        diff: buildUnifiedDiff(beforeContent, '', targetPath),
        new_hash: sha256('')
      });
      continue;
    }

    await fs.mkdir(path.dirname(absTarget), { recursive: true });
    await fs.writeFile(absTarget, afterContent, 'utf8');
    results.push(editResult(targetPath, beforeContent ? 'patch' : 'create', beforeContent, afterContent, 1));
  }

  return results.length === 1 ? results[0] : { ok: true, files: results };
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
  const file = String(args?.file || args?.path || '').trim();
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
  return {
    file,
    ast_target: args?.ast_target,
    edit: {
      kind: args?.kind,
      target: args?.target,
      new_content: args?.new_content ?? args?.content,
      old_text: args?.old_text,
      new_text: args?.new_text,
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
  if (!file || !kind) throw new Error('edit requires file and edit.kind');
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

export function getBuiltinTools({ workspaceRoot = process.cwd(), config }) {
  const definitions = [
    {
      type: 'function',
      function: {
        name: 'read',
        description:
          'Primary read tool. First call returns metadata+read_token, second call with include_content=true and matching read_token returns content',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            start_line: { type: 'number' },
            end_line: { type: 'number' },
            max_chars: { type: 'number' },
            include_content: { type: 'boolean' },
            read_token: { type: 'string' }
          },
          required: ['path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'grep',
        description: 'Search file contents using a plain string or regex pattern and return compact matches',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string' },
            query: { type: 'string' },
            path: { type: 'string' },
            regex: { type: 'boolean' },
            case_sensitive: { type: 'boolean' },
            max_results: { type: 'number' },
            language: { type: 'string' },
            file_types: { type: 'array', items: { type: 'string' } }
          },
          required: ['pattern']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'glob',
        description: 'Find files by glob pattern such as **/*.ts or src/**/*.tsx',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string' },
            path: { type: 'string' },
            include_hidden: { type: 'boolean' },
            max_results: { type: 'number' }
          },
          required: ['pattern']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list',
        description: 'List files and directories in a workspace path',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            include_hidden: { type: 'boolean' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'edit',
        description:
          'Preferred edit tool for existing files. Accepts natural forms such as file + new_content for whole-file rewrites, file + symbol/line + new_content for block edits, file + old_text + new_text for exact replacements, and file + anchor_text + content for anchored inserts. When ast_target is provided, only replace_block is allowed and the write is constrained to that exact syntax node.',
        parameters: {
          type: 'object',
          properties: {
            file: { type: 'string' },
            path: { type: 'string' },
            new_content: { type: 'string' },
            old_text: { type: 'string' },
            new_text: { type: 'string' },
            anchor_text: { type: 'string' },
            content: { type: 'string' },
            position: { type: 'string' },
            kind: { type: 'string' },
            target: { type: 'object' },
            ast_target: { type: 'object' },
            symbol: { type: 'string' },
            line: { type: 'number' },
            edit: { type: 'object' },
          },
          required: ['file']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'ast_query',
        description:
          'Run a Tree-sitter query against a code file and return explicit ast_target objects that can be passed into read_ast_node or edit for node-scoped changes.',
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
    {
      type: 'function',
      function: {
        name: 'read_ast_node',
        description:
          'Read the current source and compact structural context for a previously selected AST node using ast_target.',
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
    {
      type: 'function',
      function: {
        name: 'write',
        description:
          'Primary write tool. Create a UTF-8 text file or overwrite an existing file. Existing code files require full_file_rewrite=true for whole-file overwrites.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
            append: { type: 'boolean' },
            full_file_rewrite: { type: 'boolean' }
          },
          required: ['path', 'content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'run',
        description:
          'Primary run tool. Execute a one-shot shell command in workspace such as install, build, test, or other finite tasks. Do not use for long-running services or watchers.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string' }
          },
          required: ['command']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'generate_diff',
        description: 'Generate a unified diff between the current file and proposed content',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            new_content: { type: 'string' }
          },
          required: ['path', 'new_content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'patch',
        description: 'Apply one or more unified diff hunks to files in the workspace',
        parameters: {
          type: 'object',
          properties: {
            patch: { type: 'string' },
            content: { type: 'string' }
          },
          required: ['patch']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'start_service',
        description:
          'Start a long-running local service, such as a frontend, backend, database, or dev watcher, and return a compact service handle instead of blocking on process exit.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            startup_timeout_ms: { type: 'number' },
            success_matchers: {
              type: 'array',
              items: { type: 'string' }
            },
            port_probe: { type: 'number' },
            http_probe: {
              type: 'object',
              properties: {
                url: { type: 'string' },
                expect_status: { type: 'number' }
              }
            }
          },
          required: ['command']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_services',
        description: 'List all tracked local services and their compact current status.',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_service_status',
        description: 'Get the current status of a previously started service.',
        parameters: {
          type: 'object',
          properties: {
            task_id: { type: 'string' }
          },
          required: ['task_id']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_service_logs',
        description: 'Read recent logs from a previously started service.',
        parameters: {
          type: 'object',
          properties: {
            task_id: { type: 'string' },
            tail: { type: 'number' },
            after_cursor: { type: 'number' }
          },
          required: ['task_id']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'stop_service',
        description: 'Stop a previously started service.',
        parameters: {
          type: 'object',
          properties: {
            task_id: { type: 'string' }
          },
          required: ['task_id']
        }
      }
    }
  ].filter(Boolean);

  const handlers = {
    read: (args) =>
      readFile(workspaceRoot, {
        ...args,
        default_lines: config.context?.read_file_default_lines ?? 220,
        max_chars:
          typeof args?.max_chars === 'number'
            ? args.max_chars
            : config.context?.read_file_max_chars ?? 24000
      }),
    grep: (args) => grep(workspaceRoot, args),
    glob: (args) => glob(workspaceRoot, args),
    list: (args) => list(workspaceRoot, args),
    ast_query: (args) => queryAst(workspaceRoot, args),
    read_ast_node: (args) => readAstNode(workspaceRoot, args),
    edit: (args) => editTarget(workspaceRoot, args),
    generate_diff: (args) => generateDiff(workspaceRoot, args),
    patch: (args) => applyPatch(workspaceRoot, args),
    write: (args) => writeFile(workspaceRoot, args),
    run: (args) => runCommand(workspaceRoot, config, args),
    start_service: (args) => startService(workspaceRoot, config, args),
    list_services: () => listServices(workspaceRoot),
    get_service_status: (args) => getServiceStatus(workspaceRoot, args),
    get_service_logs: (args) => getServiceLogs(workspaceRoot, args),
    stop_service: (args) => stopService(workspaceRoot, args)
  };

  return { definitions, handlers };
}
