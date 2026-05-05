import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

import { loadConfig, saveConfig, setConfigValue, getConfigValue } from '../src/core/config-store.js';
import { createChatRuntime } from '../src/core/chat-runtime.js';
import { createSession, loadSession, listSessions, resolveSession } from '../src/core/session-store.js';
import { buildDefaultSystemPrompt } from '../src/core/default-system-prompt.js';
import { RuntimeBridge } from './lib/runtime-bridge.js';

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
  const session = sessionId ? await loadSession(sessionId) : await createSession(projectDir || process.cwd());
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
  return { runtime, config, session, cwd: process.cwd() };
}

async function main() {
  const args = parseArgs(process.argv);

  // Set initial project directory
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
      const { line } = await readBody(req);
      if (!line || typeof line !== 'string') { jsonResponse(res, { error: true, message: 'Missing "line" field' }, 400); return; }
      const result = bridge.handleSubmit(line);
      jsonResponse(res, result);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/abort') {
      bridge.handleAbort();
      jsonResponse(res, { ok: true });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/approval') {
      const { id, approved } = await readBody(req);
      jsonResponse(res, { ok: bridge.handleApproval(id, !!approved) });
      return;
    }

    // ── Runtime state ──
    if (req.method === 'GET' && url.pathname === '/api/state') {
      jsonResponse(res, { ...bridge.getState(), cwd: currentProjectDir });
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
      jsonResponse(res, bridge.getSessionMessages());
      return;
    }

    // ── Session management ──
    if (req.method === 'GET' && url.pathname === '/api/sessions') {
      const sessions = await listSessions(1000);
      jsonResponse(res, sessions);
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
            cwd: currentProjectDir
          });
          return;
        }
        const { runtime: newRuntime, session } = await buildRuntimeForSession({
          model: bridge.getState().model
        });
        await bridge.switchRuntime(newRuntime);
        currentProjectDir = process.cwd();
        jsonResponse(res, { ok: true, sessionId: session.id, cwd: currentProjectDir });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/sessions/switch') {
      const { sessionId } = await readBody(req);
      if (!sessionId) { jsonResponse(res, { error: true, message: 'Missing sessionId' }, 400); return; }
      try {
        const { runtime: newRuntime } = await buildRuntimeForSession({
          sessionId,
          model: bridge.getState().model
        });
        await bridge.switchRuntime(newRuntime);
        currentProjectDir = process.cwd();
        jsonResponse(res, { ok: true, sessionId, cwd: currentProjectDir });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }

    // ── Project management ──
    if (req.method === 'GET' && url.pathname === '/api/project') {
      jsonResponse(res, { cwd: currentProjectDir });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/project/open') {
      const { path: projectPath } = await readBody(req);
      if (!projectPath) { jsonResponse(res, { error: true, message: 'Missing path' }, 400); return; }
      try {
        const resolved = path.resolve(projectPath);
        const stat = await fs.stat(resolved);
        if (!stat.isDirectory()) throw new Error('Not a directory');
        process.chdir(resolved);
        currentProjectDir = process.cwd();
        // Re-init runtime in new project
        const { runtime: newRuntime, session } = await buildRuntimeForSession({
          model: bridge.getState().model
        });
        await bridge.switchRuntime(newRuntime);
        jsonResponse(res, { ok: true, cwd: currentProjectDir, sessionId: session.id });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 400);
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/project/browse') {
      const { dir } = await readBody(req);
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
        jsonResponse(res, { path: base, dirs });
      } catch (err) {
        jsonResponse(res, { path: base, dirs: [], error: err.message });
      }
      return;
    }

    // ── Config management ──
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

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  server.listen(args.port, () => {
    console.log(`\n  CodeMini Web UI\n  http://localhost:${args.port}\n  Project: ${currentProjectDir}\n`);
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
