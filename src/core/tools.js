import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import net from 'node:net';
import {
  hasReadyOutput,
  isDangerousCommand,
  isLikelyLongRunningCommand,
  resolveShell,
  runShellCommand,
  terminateChild
} from './shell.js';
import { evaluateCommandPolicy } from './command-policy.js';

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

function detectTextFile(filePath) {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
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
      next: 'Call read_file again with include_content=true and this read_token'
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
    throw new Error('write_file requires a file path like weather/WeatherForecast.js');
  }
  if (rawPath === '.' || rawPath === './') {
    throw new Error('write_file requires a file path, not the workspace root');
  }
  const target = resolveInWorkspace(root, rawPath);
  try {
    const stat = await fs.stat(target);
    if (stat.isDirectory()) {
      throw new Error(`write_file target is a directory: ${rawPath}`);
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
    throw new Error('run_command requires command');
  }
  if (isLikelyLongRunningCommand(command)) {
    throw new Error('Command looks like a long-running service. Use start_service instead of run_command.');
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
    const oldBlock = lines.slice(startLine - 1, endLine).join('\n');
    return {
      ok: true,
      path: relativePath,
      kind,
      target: {
        start_line: startLine,
        end_line: endLine,
        old_hash: sha256(oldBlock)
      },
      file_hash: sha256(content)
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
  const startLine = Number(target.start_line);
  const endLine = Number(target.end_line);
  const oldHash = String(target.old_hash || '');
  const state = await getFileState(root, relativePath);
  const oldBlock = state.lines.slice(startLine - 1, endLine).join('\n');
  if (!oldHash || oldHash !== sha256(oldBlock)) {
    throw new Error('replace_block old_hash mismatch');
  }
  const nextLines = [...state.lines.slice(0, startLine - 1), ...splitLines(newContent), ...state.lines.slice(endLine)];
  const afterContent = nextLines.join('\n');
  await fs.writeFile(state.target, afterContent, 'utf8');
  return editResult(relativePath, 'replace_block', state.content, afterContent, startLine);
}

async function replaceText(root, args) {
  const relativePath = String(args?.path || '').trim();
  const oldText = String(args?.old_text || '');
  const newText = String(args?.new_text || '');
  const state = await getFileState(root, relativePath);
  const occurrences = state.content.split(oldText).length - 1;
  if (occurrences !== 1) {
    throw new Error(occurrences === 0 ? 'replace_text old_text not found' : 'replace_text old_text not unique');
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

async function locate(root, args) {
  const result = await searchCode(root, args);
  return {
    query: result.query,
    matches: result.matches,
    definitions: result.definitions,
    references: result.references,
    text_matches: result.text_matches,
    truncated: result.truncated
  };
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
    edit_target: {
      start_line: block.start_line,
      end_line: block.end_line,
      old_hash: sha256(block.content)
    }
  };
}

async function editTarget(root, args) {
  const file = String(args?.file || args?.path || '').trim();
  const edit = args?.edit || {};
  const kind = String(edit.kind || '').trim();
  if (!file || !kind) throw new Error('edit_target requires file and edit.kind');
  if (kind === 'replace_block') {
    return replaceBlock(root, {
      path: file,
      target: edit.target,
      new_content: edit.new_content
    });
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
  throw new Error(`edit_target does not support kind: ${kind}`);
}

export function getBuiltinTools({ workspaceRoot = process.cwd(), config }) {
  const definitions = [
    {
      type: 'function',
      function: {
        name: 'locate',
        description: 'High-level search that returns compact candidate code locations',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            path: { type: 'string' },
            max_results: { type: 'number' },
            language: { type: 'string' },
            file_types: { type: 'array', items: { type: 'string' } }
          },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'open_target',
        description: 'Open a candidate location and return the smallest useful code block plus edit metadata',
        parameters: {
          type: 'object',
          properties: {
            file: { type: 'string' },
            path: { type: 'string' },
            line: { type: 'number' },
            symbol: { type: 'string' },
            max_related_calls: { type: 'number' },
            max_related_imports: { type: 'number' },
            max_related_types: { type: 'number' }
          },
          required: ['file']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'edit_target',
        description: 'Apply a validated high-level edit against an opened target',
        parameters: {
          type: 'object',
          properties: {
            file: { type: 'string' },
            path: { type: 'string' },
            edit: { type: 'object' }
          },
          required: ['file', 'edit']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'search_code',
        description: 'Search code and return structured top matches with file, line, preview, and basic match kind',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            path: { type: 'string' },
            max_results: { type: 'number' },
            case_sensitive: { type: 'boolean' },
            language: { type: 'string' },
            file_types: { type: 'array', items: { type: 'string' } }
          },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_block',
        description: 'Read the smallest likely code block around a symbol or line from a file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            symbol: { type: 'string' },
            line: { type: 'number' },
            anchor_line: { type: 'number' }
          },
          required: ['path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_symbol_context',
        description: 'Read a symbol block plus import and local symbol summaries',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            symbol: { type: 'string' },
            max_related_calls: { type: 'number' },
            max_related_imports: { type: 'number' },
            max_related_types: { type: 'number' }
          },
          required: ['path', 'symbol']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'validate_edit',
        description: 'Validate whether an edit target is stable before applying it',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            kind: { type: 'string' },
            target: { type: 'object' },
            start_line: { type: 'number' },
            end_line: { type: 'number' },
            old_text: { type: 'string' },
            anchor_text: { type: 'string' }
          },
          required: ['path', 'kind']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'replace_block',
        description: 'Replace a validated line block using an old_hash guard',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            target: { type: 'object' },
            new_content: { type: 'string' }
          },
          required: ['path', 'target', 'new_content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'replace_text',
        description: 'Replace a unique text fragment in a file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            old_text: { type: 'string' },
            new_text: { type: 'string' }
          },
          required: ['path', 'old_text', 'new_text']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'insert_before',
        description: 'Insert text before a unique anchor string',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            anchor_text: { type: 'string' },
            content: { type: 'string' }
          },
          required: ['path', 'anchor_text', 'content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'insert_after',
        description: 'Insert text after a unique anchor string',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            anchor_text: { type: 'string' },
            content: { type: 'string' }
          },
          required: ['path', 'anchor_text', 'content']
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
        name: 'read_file',
        description:
          'Two-phase read: first call returns metadata+read_token; second call with include_content=true and matching read_token returns content',
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
        name: 'write_file',
        description: 'Write a UTF-8 text file in workspace. Always provide a full file path, not a directory.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
            append: { type: 'boolean' }
          },
          required: ['path', 'content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'run_command',
        description: 'Execute a one-shot shell command in workspace. Do not use for long-running services.',
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
        name: 'start_service',
        description: 'Start a long-running local service and return a compact service handle instead of blocking on process exit.',
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
  ];

  const handlers = {
    locate: (args) => locate(workspaceRoot, args),
    open_target: (args) => openTarget(workspaceRoot, args),
    edit_target: (args) => editTarget(workspaceRoot, args),
    search_code: (args) => searchCode(workspaceRoot, args),
    read_block: (args) => readBlock(workspaceRoot, args),
    read_symbol_context: (args) => readSymbolContext(workspaceRoot, args),
    validate_edit: (args) => validateEdit(workspaceRoot, args),
    replace_block: (args) => replaceBlock(workspaceRoot, args),
    replace_text: (args) => replaceText(workspaceRoot, args),
    insert_before: (args) => insertRelative(workspaceRoot, args, 'insert_before'),
    insert_after: (args) => insertRelative(workspaceRoot, args, 'insert_after'),
    generate_diff: (args) => generateDiff(workspaceRoot, args),
    start_service: (args) => startService(workspaceRoot, config, args),
    list_services: () => listServices(workspaceRoot),
    get_service_status: (args) => getServiceStatus(workspaceRoot, args),
    get_service_logs: (args) => getServiceLogs(workspaceRoot, args),
    stop_service: (args) => stopService(workspaceRoot, args),
    read_file: (args) =>
      readFile(workspaceRoot, {
        ...args,
        default_lines: config.context?.read_file_default_lines ?? 220,
        max_chars:
          typeof args?.max_chars === 'number'
            ? args.max_chars
            : config.context?.read_file_max_chars ?? 24000
      }),
    write_file: (args) => writeFile(workspaceRoot, args),
    run_command: (args) => runCommand(workspaceRoot, config, args)
  };

  return { definitions, handlers };
}
