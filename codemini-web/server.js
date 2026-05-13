import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

import { loadConfig, saveConfig, setConfigValue, getConfigValue } from '../src/core/config-store.js';
import { createChatRuntime } from '../src/core/chat-runtime.js';
import { createSession, loadSession, listSessions, resolveSession, deleteSession } from '../src/core/session-store.js';
import { buildDefaultSystemPrompt } from '../src/core/default-system-prompt.js';
import { RuntimeBridge } from './lib/runtime-bridge.js';
import { listSkillEntries } from '../src/commands/skill.js';
import { readSkillRegistry, writeSkillRegistry, upsertSkillRegistryEntry } from '../src/core/skill-registry.js';
import { getReplyLanguage } from '../src/core/reply-language.js';
import { getSkillsDir, getBaseConfigDir } from '../src/core/paths.js';
import { VERSION } from '../src/core/version.js';

const GENERAL_PROJECT_DIR = (() => {
  const base = getBaseConfigDir();
  return path.join(base, 'workspace');
})();

async function listWindowsDriveRoots() {
  if (process.platform !== 'win32') return [];
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const roots = [];
  await Promise.all(letters.map(async (letter) => {
    const drivePath = `${letter}:\\`;
    try {
      await fs.access(drivePath);
      roots.push({ name: `${letter}:`, path: drivePath, isGit: false, isDrive: true });
    } catch {}
  }));
  return roots.sort((a, b) => a.name.localeCompare(b.name));
}

function isGeneralProjectDir(value) {
  if (!value) return false;
  return path.resolve(value) === path.resolve(GENERAL_PROJECT_DIR);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_SOURCE_DIR = path.join(__dirname, 'client');
let CLIENT_DIR = CLIENT_SOURCE_DIR;
try {
  const distDir = path.join(__dirname, 'dist');
  const stat = await fs.stat(distDir);
  if (stat.isDirectory()) CLIENT_DIR = distDir;
} catch {}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const DEFAULT_GATEWAY_BASE_URL = 'http://127.0.0.1:8000/v1';

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function getConfigStatus(config) {
  const baseUrl = normalizeBaseUrl(config?.gateway?.base_url);
  const apiKey = String(config?.gateway?.api_key || '').trim();
  const setupRequired = !baseUrl || (baseUrl === DEFAULT_GATEWAY_BASE_URL && !apiKey);
  return {
    setupRequired,
    baseUrl,
    hasApiKey: !!apiKey,
    reason: setupRequired ? 'gateway_not_configured' : ''
  };
}

function parseArgs(argv) {
  const parsed = { port: 3210, session: undefined, model: undefined, project: undefined, open: true };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port' || arg === '-p') { parsed.port = parseInt(argv[++i], 10) || 3210; continue; }
    if (arg === '--session' || arg === '-s') { parsed.session = argv[++i]; continue; }
    if (arg === '--model' || arg === '-m') { parsed.model = argv[++i]; continue; }
    if (arg === '--project' || arg === '-d') { parsed.project = argv[++i]; continue; }
    if (arg === '--no-open') { parsed.open = false; continue; }
  }
  return parsed;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function jsonResponse(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function buildCodeWikiAskPrompt({ question, reportPath, projectDir, replyLanguage }) {
  if (getReplyLanguage(replyLanguage) === 'en') {
    return [
      'Answer the following question based on the current project and the CodeWiki / project-requirements HTML report.',
      `Project path: ${projectDir}`,
      `Report path: ${reportPath}`,
      '',
      'Requirements:',
      '- Prefer reading and citing the HTML report above.',
      '- If the report is insufficient, use read-only project inspection to gather supporting evidence.',
      '- Do not modify files, generate a new report, or write memory.',
      '- Respond in English unless the user explicitly asks for another language.',
      '',
      `Question: ${question.trim()}`
    ].join('\n');
  }
  return [
    '请基于当前项目和 CodeWiki / project-requirements HTML 报告回答下面的问题。',
    `项目路径：${projectDir}`,
    `报告路径：${reportPath}`,
    '',
    '要求：',
    '- 优先读取并参考上述 HTML 报告。',
    '- 如果报告信息不足，可以只读检索项目文件补充证据。',
    '- 不要修改文件，不要生成新报告，不要写入记忆。',
    '- 除非用户明确要求其他语言，否则使用简体中文回答。',
    '',
    `问题：${question.trim()}`
  ].join('\n');
}

async function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': data.length });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

function normalizeProjectPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const win = raw.match(/^([A-Za-z]):[\\/](.*)$/);
  if (win && process.platform !== 'win32') {
    return path.join('/mnt', win[1].toLowerCase(), win[2].replace(/[\\/]+/g, '/'));
  }
  return path.resolve(raw);
}

function tryParseJson(value) {
  try { return JSON.parse(String(value || '')); } catch { return null; }
}

function collectSessionPathHints(session) {
  const hints = [];
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  for (const msg of messages) {
    if (Array.isArray(msg?.tool_calls)) {
      for (const call of msg.tool_calls) {
        const args = tryParseJson(call?.function?.arguments ?? call?.arguments);
        for (const key of ['path', 'file', 'filePath', 'cwd']) {
          if (typeof args?.[key] === 'string') hints.push(args[key]);
        }
      }
    }
    const content = typeof msg?.content === 'string' ? msg.content : '';
    for (const match of content.matchAll(/[A-Za-z]:[\\/][^\n\r"'`<>|]+/g)) hints.push(match[0]);
    for (const match of content.matchAll(/\/mnt\/[A-Za-z]\/[^\n\r"'`<>|]+/g)) hints.push(match[0]);
  }
  return hints;
}

async function existingDirectoryForHint(rawHint) {
  let candidate = normalizeProjectPath(rawHint);
  if (!candidate) return '';
  candidate = candidate.replace(/[),\].。；;:]+$/g, '');
  for (let i = 0; i < 8 && candidate && candidate !== path.dirname(candidate); i += 1) {
    try {
      const stat = await fs.stat(candidate);
      return stat.isDirectory() ? candidate : path.dirname(candidate);
    } catch {
      candidate = path.dirname(candidate);
    }
  }
  return '';
}

const CODEWIKI_REPORT_RE = /^[^/\\]+-project-requirements\.html$/;

function getRequirementsDir(projectDir) {
  return path.join(projectDir, 'docs', 'requirements');
}

function isCodeWikiReportFile(fileName) {
  return CODEWIKI_REPORT_RE.test(String(fileName || ''));
}

function codeWikiReportTitle(fileName) {
  return String(fileName || '')
    .replace(/-project-requirements\.html$/, '')
    .replace(/-/g, ' ');
}

function commonPathPrefix(paths) {
  const normalized = paths.map((p) => path.resolve(p).split(path.sep).filter(Boolean));
  if (!normalized.length) return '';
  const prefix = [];
  for (let i = 0; i < normalized[0].length; i += 1) {
    const part = normalized[0][i];
    if (normalized.every((parts) => parts[i] === part)) prefix.push(part);
    else break;
  }
  if (!prefix.length) return path.parse(paths[0]).root || '';
  return `${path.sep}${prefix.join(path.sep)}`;
}

async function inferSessionProjectDir(session) {
  const explicit = normalizeProjectPath(session?.projectDir);
  if (explicit) {
    try {
      if ((await fs.stat(explicit)).isDirectory()) return explicit;
    } catch {}
  }

  const dirs = [];
  for (const hint of collectSessionPathHints(session)) {
    const dir = await existingDirectoryForHint(hint);
    if (dir) dirs.push(dir);
  }
  if (dirs.length === 0) return '';

  const common = commonPathPrefix(dirs);
  let candidate = common;
  while (candidate && candidate !== path.dirname(candidate)) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) return candidate;
    } catch {}
    candidate = path.dirname(candidate);
  }
  return dirs[0];
}

async function buildRuntimeForSession({ sessionId, model, projectDir }) {
  const config = await loadConfig();
  const resolvedDir = projectDir || process.cwd();
  const session = sessionId ? await loadSession(sessionId) : await createSession(resolvedDir);
  const sessionProjectDir = projectDir ? normalizeProjectPath(projectDir) : await inferSessionProjectDir(session);
  if (sessionProjectDir) {
    try {
      const stat = await fs.stat(sessionProjectDir);
      if (stat.isDirectory()) process.chdir(sessionProjectDir);
    } catch {}
  }
  session.projectDir = process.cwd();
  const systemPrompt = buildDefaultSystemPrompt(config);
  const runtime = await createChatRuntime({
    session,
    config,
    model: model || config.model?.name,
    systemPrompt
  });
  return { runtime, config, session, cwd: process.cwd(), isGeneral: isGeneralProjectDir(process.cwd()) };
}

async function main() {
  const args = parseArgs(process.argv);

  // Ensure general workspace directory exists
  await fs.mkdir(GENERAL_PROJECT_DIR, { recursive: true });

  // Set initial project directory
  if (!args.project && !args.session) {
    process.chdir(GENERAL_PROJECT_DIR);
  }
  if (args.project) {
    try {
      const resolved = path.resolve(args.project);
      process.chdir(resolved);
    } catch {}
  }

  const { runtime: initialRuntime, config } = await buildRuntimeForSession({
    sessionId: args.session,
    model: args.model
  });
  let bridge = new RuntimeBridge(initialRuntime);
  let currentProjectDir = process.cwd();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${args.port}`);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // SSE
    if (url.pathname === '/api/events' && req.method === 'GET') {
      bridge.addClient(res);
      return;
    }

    // Static files
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      let filePath;
      if (url.pathname === '/') {
        filePath = path.join(CLIENT_DIR, 'index.html');
      } else {
        const relative = url.pathname.replace(/^\//, '');
        filePath = path.extname(relative)
          ? path.join(CLIENT_DIR, relative)
          : path.join(CLIENT_DIR, 'index.html');
      }
      if (!filePath.startsWith(CLIENT_DIR)) { res.writeHead(403); res.end(); return; }
      await serveStatic(res, filePath);
      return;
    }

    // ── Submit / Abort / Approval ──
    if (req.method === 'POST' && url.pathname === '/api/submit') {
      const { line, readOnlyCodeWiki } = await readBody(req);
      if (!line || typeof line !== 'string') { jsonResponse(res, { error: true, message: 'Missing "line" field' }, 400); return; }
      const currentConfig = await loadConfig();
      const configStatus = getConfigStatus(currentConfig);
      if (configStatus.setupRequired) {
        jsonResponse(res, {
          error: true,
          code: 'CONFIG_REQUIRED',
          message: 'Gateway is not configured. Open Settings and set the API Base URL and API Key.',
          configStatus
        }, 409);
        return;
      }
      const result = bridge.handleSubmit(line, { readOnlyCodeWiki: readOnlyCodeWiki === true });
      jsonResponse(res, result);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/abort') {
      bridge.handleAbort();
      jsonResponse(res, { ok: true });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/execution-mode') {
      const { mode } = await readBody(req);
      if (!mode || !['normal', 'auto', 'plan'].includes(mode)) {
        jsonResponse(res, { error: true, message: 'Invalid mode' }, 400);
        return;
      }
      if (bridge.isBusy()) {
        jsonResponse(res, { error: true, message: 'Cannot switch execution mode while a request is running' }, 409);
        return;
      }
      const ok = await bridge.setExecutionMode(mode);
      jsonResponse(res, { ok });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/approval') {
      const { id, approved } = await readBody(req);
      jsonResponse(res, { ok: bridge.handleApproval(id, !!approved) });
      return;
    }

    // ── Version ──
    if (req.method === 'GET' && url.pathname === '/api/version') {
      let latest = null;
      try {
        latest = execSync('npm view codemini-cli version', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      } catch {}
      jsonResponse(res, { current: VERSION, latest });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/update') {
      try {
        const output = execSync('npm update -g codemini-cli', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 });
        jsonResponse(res, { ok: true, output: output.trim() });
      } catch (err) {
        jsonResponse(res, { ok: false, error: err.message }, 500);
      }
      return;
    }

    // ── Runtime state ──
    if (req.method === 'GET' && url.pathname === '/api/state') {
      jsonResponse(res, { ...bridge.getState(), cwd: currentProjectDir, isGeneral: isGeneralProjectDir(currentProjectDir) });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/completions') {
      jsonResponse(res, bridge.getCompletions(url.searchParams.get('q') || ''));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/history') {
      jsonResponse(res, bridge.getHistory());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/commands') {
      jsonResponse(res, bridge.getCommands());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/startup-events') {
      jsonResponse(res, await bridge.handleStartupEvents());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/session/messages') {
      jsonResponse(res, { messages: bridge.getSessionMessages(), compact: bridge.getSessionCompactMeta() });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/session/ui-messages') {
      jsonResponse(res, await bridge.getUiMessages());
      return;
    }

    // ── CodeWiki / project requirements reports ──
    if (req.method === 'GET' && url.pathname === '/api/codewiki/reports') {
      const requirementsDir = getRequirementsDir(currentProjectDir);
      try {
        const entries = await fs.readdir(requirementsDir, { withFileTypes: true });
        const reports = [];
        for (const entry of entries) {
          if (!entry.isFile() || !isCodeWikiReportFile(entry.name)) continue;
          const reportPath = path.join(requirementsDir, entry.name);
          const stat = await fs.stat(reportPath);
          reports.push({
            file: entry.name,
            title: codeWikiReportTitle(entry.name),
            size: stat.size,
            mtime: stat.mtime.toISOString()
          });
        }
        reports.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
        jsonResponse(res, { reports });
      } catch (err) {
        if (err?.code === 'ENOENT') jsonResponse(res, { reports: [] });
        else jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/codewiki/report/')) {
      const fileName = decodeURIComponent(url.pathname.slice('/api/codewiki/report/'.length));
      if (!isCodeWikiReportFile(fileName)) {
        jsonResponse(res, { error: true, message: 'Invalid report file' }, 400);
        return;
      }
      const requirementsDir = path.resolve(getRequirementsDir(currentProjectDir));
      const reportPath = path.resolve(requirementsDir, fileName);
      if (!reportPath.startsWith(`${requirementsDir}${path.sep}`)) {
        jsonResponse(res, { error: true, message: 'Invalid report path' }, 403);
        return;
      }
      await serveStatic(res, reportPath);
      return;
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/codewiki/report/')) {
      const fileName = decodeURIComponent(url.pathname.slice('/api/codewiki/report/'.length));
      if (!isCodeWikiReportFile(fileName)) {
        jsonResponse(res, { error: true, message: 'Invalid report file' }, 400);
        return;
      }
      const requirementsDir = path.resolve(getRequirementsDir(currentProjectDir));
      const reportPath = path.resolve(requirementsDir, fileName);
      if (!reportPath.startsWith(`${requirementsDir}${path.sep}`)) {
        jsonResponse(res, { error: true, message: 'Invalid report path' }, 403);
        return;
      }
      try {
        await fs.unlink(reportPath);
        jsonResponse(res, { ok: true, file: fileName });
      } catch (err) {
        if (err?.code === 'ENOENT') jsonResponse(res, { error: true, message: 'Report not found' }, 404);
        else jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/codewiki/generate') {
      if (bridge.isBusy()) {
        jsonResponse(res, { error: true, message: 'Runtime is busy' }, 409);
        return;
      }
      const { depth } = await readBody(req);
      const normalizedDepth = ['fast', 'standard', 'deep'].includes(String(depth || '').toLowerCase())
        ? String(depth).toLowerCase()
        : 'standard';
      const result = bridge.handleSubmit(`/project-requirements --${normalizedDepth}`);
      jsonResponse(res, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/codewiki/ask') {
      const { question, reportFile } = await readBody(req);
      if (!question || typeof question !== 'string') {
        jsonResponse(res, { error: true, message: 'Missing "question" field' }, 400);
        return;
      }
      const currentConfig = await loadConfig();
      const configStatus = getConfigStatus(currentConfig);
      if (configStatus.setupRequired) {
        jsonResponse(res, {
          error: true,
          code: 'CONFIG_REQUIRED',
          message: 'Gateway is not configured. Open Settings and set the API Base URL and API Key.',
          configStatus
        }, 409);
        return;
      }
      const selectedReport = isCodeWikiReportFile(reportFile) ? reportFile : '';
      if (bridge.isBusy()) {
        jsonResponse(res, { error: true, message: 'Runtime is busy' }, 409);
        return;
      }
      const reportPath = selectedReport
        ? path.join(getRequirementsDir(currentProjectDir), selectedReport)
        : getRequirementsDir(currentProjectDir);
      const prompt = buildCodeWikiAskPrompt({
        question,
        reportPath,
        projectDir: currentProjectDir,
        replyLanguage: bridge.getState()?.replyLanguage
      });

      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no'
      });
      const writeEvent = (event) => {
        try {
          res.write(`${JSON.stringify(event)}\n`);
        } catch {}
      };
      await bridge.handleCodeWikiAsk(prompt, writeEvent);
      res.end();
      return;
    }

    // ── Session management ──
    if (req.method === 'GET' && url.pathname === '/api/sessions') {
      const sessions = await listSessions(1000);
      const enriched = sessions.map(s => ({ ...s, isGeneral: isGeneralProjectDir(s.projectDir) }));
      jsonResponse(res, enriched);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/sessions/new') {
      try {
        const currentMessages = bridge.getSessionMessages();
        if (!Array.isArray(currentMessages) || currentMessages.length === 0) {
          jsonResponse(res, {
            ok: true,
            reused: true,
            sessionId: bridge.getSessionId(),
            cwd: currentProjectDir,
            isGeneral: isGeneralProjectDir(currentProjectDir)
          });
          return;
        }
        const { runtime: newRuntime, session } = await buildRuntimeForSession({
          model: bridge.getState().model,
          projectDir: currentProjectDir
        });
        await bridge.switchRuntime(newRuntime);
        currentProjectDir = process.cwd();
        jsonResponse(res, { ok: true, sessionId: session.id, cwd: currentProjectDir, isGeneral: isGeneralProjectDir(currentProjectDir) });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/sessions/switch') {
      const { sessionId } = await readBody(req);
      if (!sessionId) { jsonResponse(res, { error: true, message: 'Missing sessionId' }, 400); return; }
      try {
        const { runtime: newRuntime, session: switchedSession } = await buildRuntimeForSession({
          sessionId,
          model: bridge.getState().model
        });
        await bridge.switchRuntime(newRuntime);
        currentProjectDir = process.cwd();
        jsonResponse(res, { ok: true, sessionId, cwd: currentProjectDir, isGeneral: isGeneralProjectDir(currentProjectDir) });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/sessions/')) {
      const sessionId = decodeURIComponent(url.pathname.slice('/api/sessions/'.length));
      if (!sessionId) { jsonResponse(res, { error: true, message: 'Missing sessionId' }, 400); return; }
      const deletingCurrent = sessionId === bridge.getSessionId();
      if (deletingCurrent && bridge.isBusy()) {
        jsonResponse(res, { error: true, message: 'Current session is busy' }, 409);
        return;
      }
      try {
        const result = await deleteSession(sessionId);
        let nextSessionId = bridge.getSessionId();
        let cwd = currentProjectDir;
        if (deletingCurrent) {
          const remaining = await listSessions(1000);
          const next = remaining.find((session) => session.id !== sessionId);
          const built = next
            ? await buildRuntimeForSession({ sessionId: next.id, model: bridge.getState().model })
            : await buildRuntimeForSession({ model: bridge.getState().model, projectDir: currentProjectDir });
          await bridge.switchRuntime(built.runtime);
          currentProjectDir = process.cwd();
          nextSessionId = built.session.id;
          cwd = currentProjectDir;
        }
        jsonResponse(res, { ok: true, removed: result.removed, sessionId: nextSessionId, cwd, isGeneral: isGeneralProjectDir(currentProjectDir) });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }

    // ── Project management ──
    if (req.method === 'GET' && url.pathname === '/api/project') {
      jsonResponse(res, { cwd: currentProjectDir, isGeneral: isGeneralProjectDir(currentProjectDir) });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/git') {
      try {
        const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: currentProjectDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        const porcelain = execSync('git status --porcelain', { cwd: currentProjectDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        const lines = porcelain ? porcelain.split('\n') : [];
        let staged = 0, modified = 0, untracked = 0;
        for (const line of lines) {
          const x = line[0], y = line[1];
          if (x === '?' && y === '?') { untracked++; continue; }
          if (x !== ' ' && x !== '?') staged++;
          if (y === 'M' || y === 'D') modified++;
        }
        jsonResponse(res, { isGit: true, branch, dirty: lines.length > 0, staged, modified, untracked });
      } catch {
        jsonResponse(res, { isGit: false, branch: null, dirty: false, staged: 0, modified: 0, untracked: 0 });
      }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/git-diff') {
      try {
        let patch;
        try {
          patch = execSync('git diff HEAD --no-color', { cwd: currentProjectDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        } catch {
          patch = execSync('git diff --cached --no-color', { cwd: currentProjectDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        }
        const patchFiles = [];
        const seenPatchFiles = new Set();
        for (const line of patch.split('\n')) {
          const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
          if (!match) continue;
          const filePath = match[2] || match[1];
          if (!filePath || seenPatchFiles.has(filePath)) continue;
          seenPatchFiles.add(filePath);
          patchFiles.push(filePath);
        }
        const porcelain = execSync('git status --porcelain', { cwd: currentProjectDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        const statusByPath = new Map();
        if (porcelain) {
          for (const line of porcelain.split('\n')) {
            const x = line[0], y = line[1], filePath = line.slice(3);
            let status;
            if (x === '?' && y === '?') status = '?';
            else if (x === 'A' || y === 'A') status = 'A';
            else if (x === 'D' || y === 'D') status = 'D';
            else status = 'M';
            const staged = (x !== ' ' && x !== '?');
            statusByPath.set(filePath, { path: filePath, status, staged });
          }
        }
        const files = patchFiles.map(filePath => statusByPath.get(filePath) || { path: filePath, status: 'M', staged: false });
        jsonResponse(res, { patch, files });
      } catch {
        jsonResponse(res, { patch: '', files: [] });
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/git-batch') {
      const { dirs } = await readBody(req);
      const result = {};
      for (const dir of (Array.isArray(dirs) ? dirs : [])) {
        try {
          const resolved = path.resolve(dir);
          const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: resolved, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
          result[dir] = { isGit: true, branch };
        } catch {
          result[dir] = { isGit: false, branch: null };
        }
      }
      jsonResponse(res, result);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/project/open') {
      const { path: projectPath } = await readBody(req);
      if (!projectPath) { jsonResponse(res, { error: true, message: 'Missing path' }, 400); return; }
      try {
        // Client marker for general workspace
        const openingGeneral = projectPath === '__codemini_general__';
        const resolved = openingGeneral ? GENERAL_PROJECT_DIR : path.resolve(projectPath);
        const stat = await fs.stat(resolved);
        if (!stat.isDirectory()) throw new Error('Not a directory');
        let built;
        if (openingGeneral) {
          const all = await listSessions(1000, { includeEmpty: true });
          const reusable = all.find((session) =>
            isGeneralProjectDir(session.projectDir) &&
            Number(session.messageCount || 0) === 0
          );
          built = reusable
            ? await buildRuntimeForSession({ sessionId: reusable.id, model: bridge.getState().model })
            : await buildRuntimeForSession({ model: bridge.getState().model, projectDir: GENERAL_PROJECT_DIR });
        } else {
          process.chdir(resolved);
          currentProjectDir = process.cwd();
          built = await buildRuntimeForSession({
            model: bridge.getState().model
          });
        }
        const { runtime: newRuntime, session } = built;
        await bridge.switchRuntime(newRuntime);
        currentProjectDir = process.cwd();
        jsonResponse(res, { ok: true, cwd: currentProjectDir, sessionId: session.id, isGeneral: isGeneralProjectDir(currentProjectDir) });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 400);
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/project/browse') {
      const { dir } = await readBody(req);
      const roots = await listWindowsDriveRoots();
      if (!dir && roots.length) {
        jsonResponse(res, { path: '', roots, dirs: [] });
        return;
      }
      const base = dir ? path.resolve(dir) : path.resolve('/');
      try {
        const entries = await fs.readdir(base, { withFileTypes: true });
        const dirs = entries
          .filter(e => e.isDirectory() && !e.name.startsWith('.'))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(e => ({
            name: e.name,
            path: path.join(base, e.name),
            isGit: false
          }));
        // Check for .git directories asynchronously
        await Promise.all(dirs.map(async (d) => {
          try { await fs.access(path.join(d.path, '.git')); d.isGit = true; } catch {}
        }));
        jsonResponse(res, { path: base, roots, dirs });
      } catch (err) {
        jsonResponse(res, { path: base, roots, dirs: [], error: err.message });
      }
      return;
    }

    // ── Config management ──
    if (req.method === 'GET' && url.pathname === '/api/config/status') {
      const config = await loadConfig();
      jsonResponse(res, getConfigStatus(config));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/config') {
      const config = await loadConfig();
      jsonResponse(res, config);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/config/set') {
      const { key, value } = await readBody(req);
      if (!key) { jsonResponse(res, { error: true, message: 'Missing key' }, 400); return; }
      try {
        await setConfigValue(key, value);
        const config = await loadConfig();
        await bridge.reloadConfig();
        bridge.broadcastRuntimeState();
        jsonResponse(res, { ok: true, config });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/config/get/')) {
      const key = url.pathname.slice('/api/config/get/'.length);
      const value = await getConfigValue(key);
      jsonResponse(res, { key, value });
      return;
    }

    // ── Skills management ──
    if (req.method === 'GET' && url.pathname === '/api/skills') {
      try {
        const skills = await listSkillEntries({ scope: 'all' });
        jsonResponse(res, skills);
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/skills/') && url.pathname.endsWith('/content')) {
      const name = decodeURIComponent(url.pathname.slice('/api/skills/'.length, -'/content'.length));
      try {
        const entries = await listSkillEntries({ scope: 'all' });
        const skill = entries.find(s => s.name === name);
        if (!skill) { jsonResponse(res, { error: true, message: 'Skill not found' }, 404); return; }
        const content = await fs.readFile(skill.path, 'utf8');
        jsonResponse(res, { name: skill.name, content, scope: skill.scope });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/skills/create') {
      const { name, description, content } = await readBody(req);
      if (!name || !content) { jsonResponse(res, { error: true, message: 'Missing name or content' }, 400); return; }
      try {
        const skillDir = path.join(getSkillsDir(), name);
        await fs.mkdir(skillDir, { recursive: true });
        const skillFile = path.join(skillDir, 'SKILL.md');
        await fs.writeFile(skillFile, content, 'utf8');
        const { createHash } = await import('node:crypto');
        const hash = createHash('sha256').update(content).digest('hex');
        await upsertSkillRegistryEntry(undefined, {
          name, version: '0.1.0', description: description || '', enabled: true,
          source: 'web-ui', entryFile: 'SKILL.md', sha256: hash, installedAt: new Date().toISOString()
        });
        const config = await loadConfig();
        config.skills = config.skills || {};
        config.skills.enabled = config.skills.enabled || {};
        config.skills.enabled[name] = true;
        await saveConfig(config);
        jsonResponse(res, { ok: true, name });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'PUT' && url.pathname.startsWith('/api/skills/') && url.pathname.endsWith('/content')) {
      const name = decodeURIComponent(url.pathname.slice('/api/skills/'.length, -'/content'.length));
      const { content } = await readBody(req);
      if (!content) { jsonResponse(res, { error: true, message: 'Missing content' }, 400); return; }
      try {
        const entries = await listSkillEntries({ scope: 'all' });
        const skill = entries.find(s => s.name === name);
        if (!skill) { jsonResponse(res, { error: true, message: 'Skill not found' }, 404); return; }
        if (skill.scope === 'builtin') { jsonResponse(res, { error: true, message: 'Cannot edit builtin skill' }, 403); return; }
        await fs.writeFile(skill.path, content, 'utf8');
        jsonResponse(res, { ok: true });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/skills/')) {
      const name = decodeURIComponent(url.pathname.slice('/api/skills/'.length));
      try {
        const entries = await listSkillEntries({ scope: 'all' });
        const skill = entries.find(s => s.name === name);
        if (!skill) { jsonResponse(res, { error: true, message: 'Skill not found' }, 404); return; }
        if (skill.scope === 'builtin') { jsonResponse(res, { error: true, message: 'Cannot delete builtin skill' }, 403); return; }
        const dir = path.dirname(skill.path);
        await fs.rm(dir, { recursive: true, force: true });
        const registry = await readSkillRegistry();
        registry.skills = (registry.skills || []).filter(s => s.name !== name);
        await writeSkillRegistry(undefined, registry);
        const config = await loadConfig();
        if (config.skills?.enabled) delete config.skills.enabled[name];
        await saveConfig(config);
        jsonResponse(res, { ok: true });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/skills/') && url.pathname.endsWith('/toggle')) {
      const name = decodeURIComponent(url.pathname.slice('/api/skills/'.length, -'/toggle'.length));
      const { enabled } = await readBody(req);
      try {
        const entries = await listSkillEntries({ scope: 'all' });
        const skill = entries.find(s => s.name === name);
        if (!skill) { jsonResponse(res, { error: true, message: 'Skill not found' }, 404); return; }
        if (skill.scope === 'builtin') { jsonResponse(res, { error: true, message: 'Cannot toggle builtin skill' }, 403); return; }
        const config = await loadConfig();
        config.skills = config.skills || {};
        config.skills.enabled = config.skills.enabled || {};
        config.skills.enabled[name] = !!enabled;
        await saveConfig(config);
        const registry = await readSkillRegistry();
        const idx = registry.skills.findIndex(s => s.name === name);
        if (idx !== -1) { registry.skills[idx].enabled = !!enabled; await writeSkillRegistry(undefined, registry); }
        jsonResponse(res, { ok: true });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }

    // ── Souls management ──
    const _BUNDLED_SOULS_DIR = path.resolve(__dirname, '..', 'souls');
    const _CUSTOM_SOULS_DIR = path.join(getBaseConfigDir(), 'souls');

    if (req.method === 'GET' && url.pathname === '/api/souls') {
      try {
        const config = await loadConfig();
        const activePreset = config?.soul?.preset || 'default';
        const souls = [];
        const bundledEntries = await fs.readdir(_BUNDLED_SOULS_DIR);
        for (const file of bundledEntries) {
          if (!file.endsWith('.md')) continue;
          const sname = file.slice(0, -3);
          const scontent = await fs.readFile(path.join(_BUNDLED_SOULS_DIR, file), 'utf8');
          souls.push({ name: sname, scope: 'builtin', preview: scontent.split('\n').slice(0, 3).join('\n').slice(0, 120), active: sname === activePreset });
        }
        try {
          const customEntries = await fs.readdir(_CUSTOM_SOULS_DIR);
          for (const file of customEntries) {
            if (!file.endsWith('.md')) continue;
            const sname = file.slice(0, -3);
            const scontent = await fs.readFile(path.join(_CUSTOM_SOULS_DIR, file), 'utf8');
            souls.push({ name: sname, scope: 'custom', preview: scontent.split('\n').slice(0, 3).join('\n').slice(0, 120), active: sname === activePreset });
          }
        } catch {}
        jsonResponse(res, souls);
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/souls/') && url.pathname.endsWith('/content')) {
      const sname = decodeURIComponent(url.pathname.slice('/api/souls/'.length, -'/content'.length));
      try {
        const customPath = path.join(_CUSTOM_SOULS_DIR, `${sname}.md`);
        try { const scontent = await fs.readFile(customPath, 'utf8'); jsonResponse(res, { name: sname, content: scontent, scope: 'custom' }); return; } catch {}
        const bundledPath = path.join(_BUNDLED_SOULS_DIR, `${sname}.md`);
        const scontent = await fs.readFile(bundledPath, 'utf8');
        jsonResponse(res, { name: sname, content: scontent, scope: 'builtin' });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/souls/create') {
      const { name: rawName, content: soulContent } = await readBody(req);
      if (!rawName || !soulContent) { jsonResponse(res, { error: true, message: 'Missing name or content' }, 400); return; }
      try {
        const safeName = String(rawName).replace(/[^a-zA-Z0-9_-]/g, '');
        if (!safeName) { jsonResponse(res, { error: true, message: 'Invalid name' }, 400); return; }
        const bundledCheck = path.join(_BUNDLED_SOULS_DIR, `${safeName}.md`);
        try { await fs.access(bundledCheck); jsonResponse(res, { error: true, message: 'Name conflicts with builtin soul' }, 409); return; } catch {}
        await fs.mkdir(_CUSTOM_SOULS_DIR, { recursive: true });
        await fs.writeFile(path.join(_CUSTOM_SOULS_DIR, `${safeName}.md`), soulContent, 'utf8');
        jsonResponse(res, { ok: true, name: safeName });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'PUT' && url.pathname.startsWith('/api/souls/') && url.pathname.endsWith('/content')) {
      const sname = decodeURIComponent(url.pathname.slice('/api/souls/'.length, -'/content'.length));
      const { content: soulContent } = await readBody(req);
      if (!soulContent) { jsonResponse(res, { error: true, message: 'Missing content' }, 400); return; }
      try {
        const customPath = path.join(_CUSTOM_SOULS_DIR, `${sname}.md`);
        try { await fs.access(customPath); } catch { jsonResponse(res, { error: true, message: 'Custom soul not found' }, 404); return; }
        await fs.writeFile(customPath, soulContent, 'utf8');
        jsonResponse(res, { ok: true });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/souls/')) {
      const sname = decodeURIComponent(url.pathname.slice('/api/souls/'.length));
      try {
        const bundledPath = path.join(_BUNDLED_SOULS_DIR, `${sname}.md`);
        try { await fs.access(bundledPath); jsonResponse(res, { error: true, message: 'Cannot delete builtin soul' }, 403); return; } catch {}
        const customPath = path.join(_CUSTOM_SOULS_DIR, `${sname}.md`);
        await fs.unlink(customPath);
        const config = await loadConfig();
        if (config.soul?.preset === sname) { config.soul.preset = 'default'; await saveConfig(config); }
        jsonResponse(res, { ok: true });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/souls/activate') {
      const { name: sname } = await readBody(req);
      if (!sname) { jsonResponse(res, { error: true, message: 'Missing name' }, 400); return; }
      try {
        const config = await loadConfig();
        config.soul = config.soul || {};
        config.soul.preset = sname;
        config.soul.custom_path = '';
        await saveConfig(config);
        jsonResponse(res, { ok: true });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  server.listen(args.port, () => {
    console.log(`\n  Codemini Web UI\n  http://localhost:${args.port}\n  Project: ${currentProjectDir}\n`);
    if (!args.open) return;
    const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    import('node:child_process').then(({ exec }) => {
      exec(`${openCmd} http://localhost:${args.port}`, (err) => { if (err) console.log('  Could not auto-open browser.'); });
    });
  });

  const cleanup = async () => {
    await bridge.dispose();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
