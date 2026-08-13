import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { LANGUAGE_FILE_TYPES } from './constants.js';
import { getPackageInfo } from './version.js';

const DEFAULT_COMMAND = 'fff-mcp';
const DEFAULT_TIMEOUT_MS = 15_000;
const PATH_SEPARATORS = /[\\/]/;

function normalizeComparablePath(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathInside(target, root) {
  const relative = path.relative(normalizeComparablePath(root), normalizeComparablePath(target));
  return relative === '' || (Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function isBareCommandName(command) {
  const name = String(command || '').trim();
  if (!name || name === '.' || name === '..') return false;
  return !PATH_SEPARATORS.test(name);
}

async function assertExecutableFile(filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error('FFF command must resolve to an executable file');
  if (process.platform !== 'win32') {
    await fs.access(filePath, fsConstants.X_OK).catch(() => {
      throw new Error('FFF command must resolve to an executable file');
    });
  }
}

function pathLookupNames(name) {
  if (process.platform !== 'win32') return [name];
  const ext = path.extname(name);
  const pathExt = String(process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM');
  const exts = pathExt.split(';').map((item) => item.trim()).filter(Boolean);
  if (ext && exts.some((item) => item.toLowerCase() === ext.toLowerCase())) {
    return [name];
  }
  return [name, ...exts.map((item) => `${name}${item}`)];
}

async function resolveBareCommandOnPath(name, workspace) {
  const entries = String(process.env.PATH || '').split(path.delimiter);
  const names = pathLookupNames(name);
  for (const dir of entries) {
    const trimmed = String(dir || '').trim();
    if (!trimmed || trimmed === '.') continue;
    const absDir = path.resolve(trimmed);
    if (isPathInside(absDir, workspace)) continue;
    for (const candidateName of names) {
      const candidate = path.join(absDir, candidateName);
      if (isPathInside(candidate, workspace)) continue;
      try {
        const real = await fs.realpath(candidate);
        if (isPathInside(real, workspace)) continue;
        await assertExecutableFile(real);
        return real;
      } catch {
        // Keep scanning PATH.
      }
    }
  }
  throw new Error(`FFF command not found on PATH: ${name}`);
}

export async function resolveTrustedFffCommand(command, workspaceRoot) {
  const raw = String(command || '').trim();
  if (!raw) {
    throw new Error('FFF command is empty');
  }
  const workspace = await fs.realpath(path.resolve(workspaceRoot));
  if (isBareCommandName(raw)) return resolveBareCommandOnPath(raw, workspace);
  if (!path.isAbsolute(raw)) {
    throw new Error('FFF command must be a PATH program name or an absolute path outside the workspace');
  }
  const resolved = path.resolve(raw);
  if (isPathInside(resolved, workspace)) {
    throw new Error('FFF command cannot point at a workspace file');
  }
  const real = await fs.realpath(resolved).catch(() => {
    throw new Error('FFF command must exist and resolve outside the workspace');
  });
  if (isPathInside(real, workspace)) {
    throw new Error('FFF command cannot point at a workspace file');
  }
  await assertExecutableFile(real);
  return real;
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function encodeMessage(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8'),
    body
  ]);
}

function createMessageParser(onMessage) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    while (buffer.length > 0) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const headerText = buffer.slice(0, headerEnd).toString('utf8');
      const match = headerText.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buffer = Buffer.alloc(0);
        return;
      }
      const bodyLength = Number(match[1]);
      const totalLength = headerEnd + 4 + bodyLength;
      if (buffer.length < totalLength) return;
      const body = buffer.slice(headerEnd + 4, totalLength).toString('utf8');
      buffer = buffer.slice(totalLength);
      try {
        onMessage(JSON.parse(body));
      } catch {
        // Ignore malformed frames.
      }
    }
  };
}

class FffMcpClient {
  constructor({ workspaceRoot, command, timeoutMs }) {
    this.workspaceRoot = workspaceRoot;
    this.command = command;
    this.timeoutMs = timeoutMs;
    this.child = null;
    this.pending = new Map();
    this.nextId = 1;
    this.connectPromise = null;
    this.connected = false;
    this.closed = false;
    this.parser = createMessageParser((message) => this.handleMessage(message));
  }

  handleMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (typeof message.id !== 'number') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(String(message.error?.message || 'Unknown MCP error')));
      return;
    }
    pending.resolve(message.result);
  }

  async connect() {
    if (this.connected) return;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.start();
    try {
      await this.connectPromise;
      this.connected = true;
    } finally {
      this.connectPromise = null;
    }
  }

  async start() {
    if (this.closed) {
      throw new Error('FFF MCP client already disposed');
    }
    const command = await resolveTrustedFffCommand(this.command, this.workspaceRoot);
    this.child = execa(command, [], {
      cwd: this.workspaceRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
      reject: false
    });

    this.child.stdout.on('data', this.parser);
    this.child.stderr.on('data', () => {});
    this.child.nodeChildProcess.on('error', (error) => {
      this.rejectAll(error);
    });
    this.child.nodeChildProcess.on('exit', (code) => {
      this.connected = false;
      this.child = null;
      if (!this.closed && code !== 0) {
        this.rejectAll(new Error(`FFF MCP exited with code ${code}`));
      }
    });

    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: getPackageInfo()
    });
    this.sendNotification('notifications/initialized', {});
  }

  rejectAll(error) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
  }

  sendNotification(method, params) {
    if (!this.child?.stdin) throw new Error('FFF MCP client is not connected');
    this.child.stdin.write(
      encodeMessage({
        jsonrpc: '2.0',
        method,
        params
      })
    );
  }

  sendRequest(method, params) {
    if (!this.child?.stdin) {
      return Promise.reject(new Error('FFF MCP client is not connected'));
    }
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`FFF MCP request timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        timer
      });
      this.child.stdin.write(
        encodeMessage({
          jsonrpc: '2.0',
          id,
          method,
          params
        })
      );
    });
  }

  async callTool(name, args) {
    await this.connect();
    return this.sendRequest('tools/call', {
      name,
      arguments: args
    });
  }

  async dispose() {
    this.closed = true;
    this.connected = false;
    if (this.child?.stdin) {
      try {
        this.child.stdin.end();
      } catch {}
    }
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
    this.child = null;
    this.rejectAll(new Error('FFF MCP client disposed'));
  }
}

function extractTextContent(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  return content
    .filter((item) => item?.type === 'text' && typeof item?.text === 'string')
    .map((item) => item.text)
    .join('\n')
    .trim();
}

function stripFffFileSuffix(line) {
  return String(line || '')
    .replace(/\s+-\s+(?:hot|warm|frequent)(?:\s+git:[a-z_]+)?$/i, '')
    .replace(/\s+git:[a-z_]+$/i, '')
    .trim();
}

function parseFindFilesOutput(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const matches = [];
  for (const line of lines) {
    if (
      line.startsWith('→ ') ||
      line.startsWith('cursor:') ||
      /^\d+\/\d+\s+matches$/i.test(line) ||
      /^0 results\b/i.test(line)
    ) {
      continue;
    }
    const normalized = stripFffFileSuffix(line);
    if (normalized) matches.push(normalized);
  }
  return matches;
}

function parseGrepOutput(text, fallbackPattern = '') {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const matches = [];
  let currentPath = '';
  for (const line of lines) {
    if (
      line.startsWith('→ ') ||
      line.startsWith('cursor:') ||
      /^! regex failed:/i.test(line) ||
      /^\d+\/\d+\s+matches shown$/i.test(line) ||
      /^0 (?:exact )?matches\b/i.test(line) ||
      /^Auto-broadened to\b/i.test(line)
    ) {
      continue;
    }
    const sectionMatch = line.match(/^\s*(\d+)\s*[:|-]\s*(.*)$/);
    if (sectionMatch && currentPath) {
      const [, lineNumber, preview] = sectionMatch;
      matches.push({
        path: currentPath,
        line: Number(lineNumber),
        column: 1,
        preview: String(preview || '').trim()
      });
      continue;
    }
    const fileCandidate = stripFffFileSuffix(line);
    if (fileCandidate && !/^\d/.test(fileCandidate)) {
      currentPath = fileCandidate;
    }
  }
  return {
    pattern: fallbackPattern,
    matches,
    truncated: /cursor:/i.test(text)
  };
}

function normalizePathPrefix(value) {
  const text = String(value || '').trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!text || text === '.') return '';
  return text.endsWith('/') ? text : `${text}/`;
}

function buildGrepQuery(pattern, args = {}) {
  const pieces = [];
  const pathPrefix = normalizePathPrefix(args.path);
  if (pathPrefix) pieces.push(pathPrefix);
  const fileTypes = Array.isArray(args.file_types) ? args.file_types : [];
  const language = String(args.language || '').trim().toLowerCase();
  const mergedTypes = [...new Set([...fileTypes, ...(LANGUAGE_FILE_TYPES[language] || [])])];
  if (mergedTypes.length === 1) {
    pieces.push(`*.${mergedTypes[0]}`);
  } else if (mergedTypes.length > 1) {
    pieces.push(`*.{${mergedTypes.join(',')}}`);
  }
  pieces.push(String(pattern || '').trim());
  return pieces.filter(Boolean).join(' ');
}

function buildImmediateItems(relativePath, filePaths, includeHidden = false) {
  const prefix = normalizePathPrefix(relativePath);
  const directories = new Set();
  const files = new Set();
  for (const filePath of filePaths) {
    const normalized = String(filePath || '').replace(/\\/g, '/');
    if (!normalized.startsWith(prefix)) continue;
    const remainder = normalized.slice(prefix.length);
    if (!remainder) continue;
    const [head, ...rest] = remainder.split('/');
    if (!head) continue;
    if (!includeHidden && head.startsWith('.')) continue;
    if (rest.length > 0) {
      directories.add(head);
    } else {
      files.add(head);
    }
  }
  const dirItems = [...directories].sort((a, b) => a.localeCompare(b)).map((name) => ({
    name,
    path: `${prefix}${name}`.replace(/\/$/, ''),
    type: 'dir'
  }));
  const fileItems = [...files].sort((a, b) => a.localeCompare(b)).map((name) => ({
    name,
    path: `${prefix}${name}`,
    type: 'file'
  }));
  return [...dirItems, ...fileItems];
}

export function createFffAdapter({ workspaceRoot, config }) {
  const command = String(config?.search?.fff_command || config?.tooling?.fff_command || DEFAULT_COMMAND).trim() || DEFAULT_COMMAND;
  const timeoutMs = clampNumber(
    config?.search?.fff_timeout_ms || config?.tooling?.fff_timeout_ms,
    1_000,
    120_000,
    DEFAULT_TIMEOUT_MS
  );
  const client = new FffMcpClient({ workspaceRoot, command, timeoutMs });

  return {
    async connect() {
      await client.connect();
    },

    async grep(args) {
      const pattern = String(args?.pattern || '').trim();
      if (!pattern) return null;
      const result = await client.callTool('grep', {
        query: buildGrepQuery(pattern, args),
        max_results: clampNumber(args?.max_results, 1, 200, 50)
      });
      return parseGrepOutput(extractTextContent(result), pattern);
    },

    async glob(args) {
      const pattern = String(args?.pattern || '').trim();
      if (!pattern) return null;
      const limit = clampNumber(args?.max_results, 1, 500, 200);
      const result = await client.callTool('find_files', {
        query: pattern,
        max_results: limit
      });
      const matches = parseFindFilesOutput(extractTextContent(result));
      return {
        pattern,
        matches,
        truncated: matches.length >= limit
      };
    },

    async list(args) {
      const relativePath = String(args?.path || '.').trim();
      if (!relativePath || relativePath === '.') return null;
      const result = await client.callTool('find_files', {
        query: normalizePathPrefix(relativePath),
        max_results: 500
      });
      const filePaths = parseFindFilesOutput(extractTextContent(result));
      return {
        path: relativePath,
        items: buildImmediateItems(relativePath, filePaths, Boolean(args?.include_hidden))
      };
    },

    async dispose() {
      await client.dispose();
    }
  };
}
