import fs from 'node:fs/promises';
import path from 'node:path';
import { getSessionsDir } from './paths.js';
import { normalizeTodos } from './todo-state.js';

const ALLOWED_ROLES = new Set(['system', 'user', 'assistant', 'tool']);
const SESSION_LEGACY_EXT = '.json';
const SESSION_JSONL_EXT = '.jsonl';

function createSessionId() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}`;
}

function sanitizeToolCall(tc, index) {
  const id = String(tc?.id || `tc-${index + 1}`);
  const fnName = String(tc?.function?.name || tc?.name || '').trim();
  const fnArgsRaw = tc?.function?.arguments ?? tc?.arguments ?? '{}';
  const fnArgs = typeof fnArgsRaw === 'string' ? fnArgsRaw : JSON.stringify(fnArgsRaw);
  if (!fnName) return null;
  return {
    id,
    type: 'function',
    function: {
      name: fnName,
      arguments: fnArgs
    }
  };
}

function sanitizeMessage(msg) {
  const role = String(msg?.role || '').trim();
  if (!ALLOWED_ROLES.has(role)) return null;
  const content =
    typeof msg?.content === 'string' || Array.isArray(msg?.content) ? msg.content : String(msg?.content || '');

  const out = {
    role,
    content
  };

  if (msg?.tool_call_id) out.tool_call_id = String(msg.tool_call_id);
  if (typeof msg?.name === 'string' && msg.name.trim()) out.name = msg.name.trim();
  if (typeof msg?.at === 'string' && msg.at.trim()) out.at = msg.at;
  if (typeof msg?.reasoning_content === 'string' && msg.reasoning_content) {
    out.reasoning_content = msg.reasoning_content;
  }
  if (Array.isArray(msg?.reasoning_details) && msg.reasoning_details.length > 0) {
    out.reasoning_details = msg.reasoning_details
      .filter((detail) => detail && typeof detail === 'object')
      .map((detail) => ({ ...detail }));
  }

  if (Array.isArray(msg?.tool_calls)) {
    const toolCalls = msg.tool_calls.map(sanitizeToolCall).filter(Boolean);
    if (toolCalls.length > 0) out.tool_calls = toolCalls;
  }

  return out;
}

function sanitizeSession(session, fallbackId = '') {
  const id = String(session?.id || fallbackId || '').trim();
  if (!id) throw new Error('Session id is required');
  const now = new Date().toISOString();
  const createdAt = String(session?.createdAt || now);
  const updatedAt = String(session?.updatedAt || now);
  const messages = Array.isArray(session?.messages) ? session.messages.map(sanitizeMessage).filter(Boolean) : [];

  const out = {
    id,
    createdAt,
    updatedAt,
    messages
  };

  if (session?.model) out.model = String(session.model);
  if (session?.mode) out.mode = String(session.mode);
  if (session?.planState && typeof session.planState === 'object') {
    out.planState = {
      status: String(session.planState.status || '').trim(),
      source: String(session.planState.source || '').trim(),
      goal: String(session.planState.goal || '').trim(),
      filePath: String(session.planState.filePath || '').trim(),
      summary: String(session.planState.summary || '').trim(),
      finalSummary: String(session.planState.finalSummary || '').trim()
    };
    if (Array.isArray(session.planState.steps)) {
      out.planState.steps = session.planState.steps
        .map((step) => ({
          title: String(step?.title || '').trim(),
          role: String(step?.role || '').trim(),
          task: String(step?.task || '').trim()
        }))
        .filter((step) => step.title || step.role || step.task);
    }
  }

  const todos = normalizeTodos(session?.todos);
  if (todos.length > 0) out.todos = todos;

  return out;
}

function sessionPathById(sessionId, ext = SESSION_JSONL_EXT) {
  return path.join(getSessionsDir(), `${sessionId}${ext}`);
}

function sessionIdFromFileName(fileName) {
  if (fileName.endsWith(SESSION_JSONL_EXT)) return fileName.slice(0, -SESSION_JSONL_EXT.length);
  if (fileName.endsWith(SESSION_LEGACY_EXT)) return fileName.slice(0, -SESSION_LEGACY_EXT.length);
  return '';
}

function summarizeParsedSession(parsed, filePath) {
  const id = parsed.id || sessionIdFromFileName(path.basename(filePath));
  const updatedAt = parsed.updatedAt || parsed.createdAt || '';
  const latestMessage = Array.isArray(parsed.messages) ? parsed.messages.at(-1) : null;
  const preview = latestMessage?.content ? String(latestMessage.content).replace(/\s+/g, ' ').slice(0, 80) : '';
  return {
    id,
    updatedAt,
    messageCount: Array.isArray(parsed.messages) ? parsed.messages.length : 0,
    preview
  };
}

async function tryReadJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function loadLatestJsonlObject(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  const lines = String(raw || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      continue;
    }
  }
  throw new Error(`No valid JSONL record found: ${filePath}`);
}

async function loadSessionPayload(sessionId) {
  const jsonlPath = sessionPathById(sessionId, SESSION_JSONL_EXT);
  let jsonlError = null;
  try {
    return await loadLatestJsonlObject(jsonlPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') jsonlError = error;
  }
  const legacyPath = sessionPathById(sessionId, SESSION_LEGACY_EXT);
  try {
    return await tryReadJson(legacyPath);
  } catch (error) {
    if (jsonlError) throw jsonlError;
    throw error;
  }
}

export async function createSession() {
  const sessionId = createSessionId();
  const dir = getSessionsDir();
  await fs.mkdir(dir, { recursive: true });
  const filePath = sessionPathById(sessionId, SESSION_JSONL_EXT);
  const payload = {
    id: sessionId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: []
  };
  await fs.writeFile(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
  return payload;
}

export async function loadSession(sessionId) {
  const parsed = await loadSessionPayload(sessionId);
  return sanitizeSession(parsed, sessionId);
}

export async function saveSession(session) {
  const dir = getSessionsDir();
  await fs.mkdir(dir, { recursive: true });
  const normalized = sanitizeSession(session);
  normalized.updatedAt = new Date().toISOString();
  const filePath = sessionPathById(normalized.id, SESSION_JSONL_EXT);
  await fs.appendFile(filePath, `${JSON.stringify(normalized)}\n`, 'utf8');
}

export async function resolveSession(sessionId) {
  if (sessionId) {
    return loadSession(sessionId);
  }
  return createSession();
}

export async function listSessions(limit = 30) {
  const dir = getSessionsDir();
  await fs.mkdir(dir, { recursive: true });
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && (e.name.endsWith(SESSION_JSONL_EXT) || e.name.endsWith(SESSION_LEGACY_EXT)))
    .map((e) => path.join(dir, e.name));

  const sessionsById = new Map();
  for (const file of files) {
    try {
      const parsed = file.endsWith(SESSION_JSONL_EXT) ? await loadLatestJsonlObject(file) : await tryReadJson(file);
      const summary = summarizeParsedSession(parsed, file);
      if (!summary.id) continue;
      const existing = sessionsById.get(summary.id);
      if (!existing || String(summary.updatedAt) > String(existing.updatedAt)) {
        sessionsById.set(summary.id, summary);
      }
    } catch {
      continue;
    }
  }

  const sessions = Array.from(sessionsById.values());
  sessions.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return sessions.filter((s) => Number(s.messageCount || 0) > 0).slice(0, limit);
}

export async function pruneSessions(policy = {}) {
  const maxSessions = Number(policy.max_sessions || 100);
  const retentionDays = Number(policy.retention_days || 30);
  const all = await listSessions(10000);
  const now = Date.now();
  const expireMs = retentionDays > 0 ? retentionDays * 24 * 60 * 60 * 1000 : 0;
  const keepIds = new Set();

  const sorted = [...all].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  for (let i = 0; i < sorted.length; i += 1) {
    const s = sorted[i];
    if (i >= maxSessions) continue;
    if (expireMs > 0 && s.updatedAt) {
      const t = Date.parse(s.updatedAt);
      if (!Number.isNaN(t) && now - t > expireMs) continue;
    }
    keepIds.add(s.id);
  }

  const dir = getSessionsDir();
  const entries = await fs.readdir(dir, { withFileTypes: true });
  let removed = 0;
  for (const e of entries) {
    if (!e.isFile()) continue;
    const id = sessionIdFromFileName(e.name);
    if (!id) continue;
    if (keepIds.has(id)) continue;
    try {
      await fs.unlink(path.join(dir, e.name));
      removed += 1;
    } catch {
      continue;
    }
  }
  return { removed, kept: keepIds.size };
}
