import fs from 'node:fs/promises';
import path from 'node:path';
import { getSessionsDir } from './paths.js';
import { normalizePlanState } from './plan-state.js';
import { normalizeTodos } from './todo-state.js';

const ALLOWED_ROLES = new Set(['system', 'user', 'assistant', 'tool']);
const SESSION_LEGACY_EXT = '.json';
const SESSION_JSONL_EXT = '.jsonl';
const SESSION_INDEX_FILE = 'index.json';
const SESSION_INDEX_VERSION = 1;
const DEFAULT_SESSION_TITLE = '新会话';

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
  const out = {
    id,
    type: 'function',
    function: {
      name: fnName,
      arguments: fnArgs
    }
  };
  if (Number.isFinite(Number(tc?.durationMs))) out.durationMs = Number(tc.durationMs);
  if (typeof tc?.summary === 'string' && tc.summary.trim()) out.summary = tc.summary.trim();
  if (typeof tc?.status === 'string' && tc.status.trim()) out.status = tc.status.trim();
  return out;
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sanitizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const out = {};
  const copyNumber = (from, to = from) => {
    const value = Number(usage?.[from]);
    if (Number.isFinite(value)) out[to] = Math.max(0, Math.round(value));
  };
  copyNumber('inputTokens');
  copyNumber('outputTokens');
  copyNumber('totalTokens');
  copyNumber('cachedInputTokens');
  copyNumber('cacheMissInputTokens');
  copyNumber('cacheWriteInputTokens');
  copyNumber('reasoningOutputTokens');
  copyNumber('requests');
  if (Array.isArray(usage.raw) && usage.raw.length > 0) {
    out.raw = usage.raw.filter((item) => item && typeof item === 'object').map((item) => ({ ...item }));
  } else if (usage.raw && typeof usage.raw === 'object') {
    out.raw = [{ ...usage.raw }];
  }
  return Object.keys(out).length ? out : null;
}

function stripMarkdown(value) {
  return normalizeWhitespace(value)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[#>*\-\d.\s]+/g, '')
    .trim();
}

export function deriveSessionTitle(messages = []) {
  const firstUser = Array.isArray(messages)
    ? messages.find((msg) => msg?.role === 'user' && normalizeWhitespace(msg?.content))
    : null;
  const text = stripMarkdown(firstUser?.content || '');
  if (!text) return DEFAULT_SESSION_TITLE;
  return text.length > 48 ? `${text.slice(0, 45).trimEnd()}...` : text;
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

  if (typeof msg?.model_content === 'string' && msg.model_content) out.model_content = msg.model_content;
  if (msg?.tool_call_id) out.tool_call_id = String(msg.tool_call_id);
  if (Number.isFinite(Number(msg?.tool_duration_ms))) out.tool_duration_ms = Number(msg.tool_duration_ms);
  if (typeof msg?.tool_summary === 'string' && msg.tool_summary.trim()) out.tool_summary = msg.tool_summary.trim();
  if (typeof msg?.tool_status === 'string' && msg.tool_status.trim()) out.tool_status = msg.tool_status.trim();
  if (typeof msg?.name === 'string' && msg.name.trim()) out.name = msg.name.trim();
  if (typeof msg?.at === 'string' && msg.at.trim()) out.at = msg.at;
  if (typeof msg?.reasoning_content === 'string' && msg.reasoning_content) {
    out.reasoning_content = msg.reasoning_content;
  }
  if (typeof msg?.reasoning_started_at === 'string' && msg.reasoning_started_at.trim()) {
    out.reasoning_started_at = msg.reasoning_started_at;
  }
  if (typeof msg?.reasoning_ended_at === 'string' && msg.reasoning_ended_at.trim()) {
    out.reasoning_ended_at = msg.reasoning_ended_at;
  }
  if (Number.isFinite(Number(msg?.reasoning_duration_ms))) {
    out.reasoning_duration_ms = Math.max(0, Math.round(Number(msg.reasoning_duration_ms)));
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
  const usage = sanitizeUsage(msg?.usage);
  if (usage) out.usage = usage;

  if (Array.isArray(msg?.plan_transcript)) {
    out.plan_transcript = msg.plan_transcript
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => {
        const { usage, ...rest } = entry;
        const cleanUsage = sanitizeUsage(usage);
        return {
          ...rest,
          ...(cleanUsage ? { usage: cleanUsage } : {}),
          segments: Array.isArray(entry.segments) ? entry.segments : []
        };
      });
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
  const compactView = Array.isArray(session?.compact?.view)
    ? session.compact.view.map(sanitizeMessage).filter(Boolean)
    : [];

  const out = {
    id,
    createdAt,
    updatedAt,
    title: normalizeWhitespace(session?.title) || deriveSessionTitle(messages),
    messages
  };

  if (typeof session?.projectDir === 'string' && session.projectDir.trim()) {
    out.projectDir = session.projectDir.trim();
  }
  if (session?.model) out.model = String(session.model);
  if (session?.mode) out.mode = String(session.mode);
  const normalizedPlan = normalizePlanState(session?.planState);
  if (normalizedPlan) out.planState = normalizedPlan;

  const todos = normalizeTodos(session?.todos);
  if (todos.length > 0) out.todos = todos;

  if (compactView.length > 0) {
    out.compact = {
      view: compactView,
      timestamp: typeof session?.compact?.timestamp === 'string' && session.compact.timestamp.trim()
        ? session.compact.timestamp
        : now
    };
    if (Number.isFinite(Number(session?.compact?.boundaryIndex))) {
      out.compact.boundaryIndex = Number(session.compact.boundaryIndex);
    }
    if (typeof session?.compact?.mode === 'string' && session.compact.mode.trim()) {
      out.compact.mode = session.compact.mode.trim();
    }
  }

  return out;
}

function sessionPathById(sessionId, ext = SESSION_JSONL_EXT) {
  return path.join(getSessionsDir(), `${sessionId}${ext}`);
}

function sessionIndexPath() {
  return path.join(getSessionsDir(), SESSION_INDEX_FILE);
}

function isSafeSessionId(sessionId) {
  return /^[A-Za-z0-9_.-]+$/.test(String(sessionId || ''));
}

function sessionIdFromFileName(fileName) {
  if (fileName.endsWith(SESSION_JSONL_EXT)) return fileName.slice(0, -SESSION_JSONL_EXT.length);
  if (fileName.endsWith(SESSION_LEGACY_EXT)) return fileName.slice(0, -SESSION_LEGACY_EXT.length);
  return '';
}

async function listSessionFiles() {
  const dir = getSessionsDir();
  await fs.mkdir(dir, { recursive: true });
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && (e.name.endsWith(SESSION_JSONL_EXT) || e.name.endsWith(SESSION_LEGACY_EXT)))
    .map((e) => path.join(dir, e.name));
}

async function listSessionFileMeta() {
  const files = await listSessionFiles();
  const meta = [];
  for (const file of files) {
    try {
      const stat = await fs.stat(file);
      meta.push({
        name: path.basename(file),
        size: stat.size,
        mtimeMs: Math.trunc(stat.mtimeMs)
      });
    } catch {
      continue;
    }
  }
  meta.sort((a, b) => a.name.localeCompare(b.name));
  return meta;
}

function sameSessionFileMeta(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]?.name !== b[i]?.name) return false;
    if (Number(a[i]?.size || 0) !== Number(b[i]?.size || 0)) return false;
    if (Number(a[i]?.mtimeMs || 0) !== Number(b[i]?.mtimeMs || 0)) return false;
  }
  return true;
}

function summarizeParsedSession(parsed, filePath) {
  const id = parsed.id || sessionIdFromFileName(path.basename(filePath));
  const updatedAt = parsed.updatedAt || parsed.createdAt || '';
  const latestMessage = Array.isArray(parsed.messages) ? parsed.messages.at(-1) : null;
  const preview = latestMessage?.content ? String(latestMessage.content).replace(/\s+/g, ' ').slice(0, 80) : '';
  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  return {
    id,
    title: normalizeWhitespace(parsed.title) || deriveSessionTitle(messages),
    updatedAt,
    messageCount: Array.isArray(parsed.messages) ? parsed.messages.length : 0,
    preview,
    projectDir: typeof parsed.projectDir === 'string' ? parsed.projectDir : '',
    model: typeof parsed.model === 'string' ? parsed.model : '',
    mode: typeof parsed.mode === 'string' ? parsed.mode : ''
  };
}

async function tryReadJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function readSessionIndex() {
  try {
    const index = await tryReadJson(sessionIndexPath());
    if (index?.version !== SESSION_INDEX_VERSION || !Array.isArray(index?.sessions) || !Array.isArray(index?.files)) {
      return null;
    }
    return index;
  } catch {
    return null;
  }
}

async function writeSessionIndex(index) {
  const dir = getSessionsDir();
  await fs.mkdir(dir, { recursive: true });
  const filePath = sessionIndexPath();
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const payload = {
    version: SESSION_INDEX_VERSION,
    updatedAt: new Date().toISOString(),
    files: Array.isArray(index?.files) ? index.files : [],
    sessions: Array.isArray(index?.sessions) ? index.sessions : []
  };
  await fs.writeFile(tempPath, `${JSON.stringify(payload)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

async function rebuildSessionIndex(fileMeta = null) {
  const files = await listSessionFiles();
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
  const filesMeta = fileMeta || await listSessionFileMeta();
  const index = { files: filesMeta, sessions };
  await writeSessionIndex(index);
  return { ...index, version: SESSION_INDEX_VERSION };
}

async function getSessionIndex() {
  const fileMeta = await listSessionFileMeta();
  const index = await readSessionIndex();
  if (index && sameSessionFileMeta(index.files, fileMeta)) return index;
  return rebuildSessionIndex(fileMeta);
}

async function upsertSessionIndexEntry(session, filePath) {
  try {
    const summary = summarizeParsedSession(session, filePath);
    if (!summary.id) return;
    const stat = await fs.stat(filePath);
    const fileEntry = {
      name: path.basename(filePath),
      size: stat.size,
      mtimeMs: Math.trunc(stat.mtimeMs)
    };
    const index = await readSessionIndex();
    const files = Array.isArray(index?.files) ? index.files.filter((entry) => entry?.name !== fileEntry.name) : [];
    files.push(fileEntry);
    files.sort((a, b) => a.name.localeCompare(b.name));
    const sessions = Array.isArray(index?.sessions) ? index.sessions.filter((entry) => entry?.id !== summary.id) : [];
    sessions.push(summary);
    sessions.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    await writeSessionIndex({ files, sessions });
  } catch {
    // Index updates are an optimization; session data remains authoritative.
  }
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

export async function createSession(projectDir = process.cwd()) {
  const sessionId = createSessionId();
  const dir = getSessionsDir();
  await fs.mkdir(dir, { recursive: true });
  const filePath = sessionPathById(sessionId, SESSION_JSONL_EXT);
  const payload = {
    id: sessionId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    title: DEFAULT_SESSION_TITLE,
    projectDir: String(projectDir || process.cwd()),
    messages: []
  };
  await fs.writeFile(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
  await upsertSessionIndexEntry(payload, filePath);
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
  await upsertSessionIndexEntry(normalized, filePath);
}

export async function resolveSession(sessionId) {
  if (sessionId) {
    return loadSession(sessionId);
  }
  return createSession();
}

export async function listSessions(limit = 30, { includeEmpty = false } = {}) {
  const index = await getSessionIndex();
  return [...index.sessions]
    .filter((s) => includeEmpty || Number(s.messageCount || 0) > 0)
    .slice(0, limit);
}

export async function deleteSession(sessionId) {
  const id = String(sessionId || '').trim();
  if (!id || !isSafeSessionId(id)) {
    throw new Error('Invalid session id');
  }

  const files = await listSessionFiles();
  const targets = new Set();
  for (const file of files) {
    const fileId = sessionIdFromFileName(path.basename(file));
    if (fileId === id) {
      targets.add(file);
      continue;
    }
    try {
      const parsed = file.endsWith(SESSION_JSONL_EXT) ? await loadLatestJsonlObject(file) : await tryReadJson(file);
      if (String(parsed?.id || '').trim() === id) targets.add(file);
    } catch {}
  }

  let removed = 0;
  const fallbackTargets = [
    sessionPathById(id, SESSION_JSONL_EXT),
    sessionPathById(id, SESSION_LEGACY_EXT)
  ];
  for (const file of [...targets, ...fallbackTargets]) {
    try {
      await fs.unlink(file);
      removed += 1;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  if (removed > 0) {
    try {
      await rebuildSessionIndex();
    } catch {}
  }
  return { removed };
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
  try {
    await rebuildSessionIndex();
  } catch {}
  return { removed, kept: keepIds.size };
}
