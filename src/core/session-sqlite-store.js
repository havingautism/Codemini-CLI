import { getGlobalDatabase, transaction } from './sqlite-database.js';

const lastSavedOriginals = new Map();
const lastSavedCounts = new Map();

function messageText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content || '');
  return content.map((part) => typeof part === 'string' ? part : String(part?.text || '')).join('');
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function forgetSessionMessageRefs(sessionId) {
  lastSavedOriginals.delete(sessionId);
  lastSavedCounts.delete(sessionId);
}

export function sessionMessageWriteStart(sessionId, messages = []) {
  const prev = lastSavedOriginals.get(sessionId) || [];
  let start = messages.length;
  for (let index = 0; index < messages.length; index += 1) {
    if (prev[index] !== messages[index]) {
      start = index;
      break;
    }
  }
  // ponytail: in-place tool meta can land on the last assistant after a later tool result was pushed.
  // Late tool:end after the next assistant:start would miss; rewrite that assistant too if it starts happening.
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') {
      start = Math.min(start, index);
      break;
    }
  }
  if (messages.length > 0) start = Math.min(start, messages.length - 1);
  return start;
}

export function rememberSessionMessageRefs(sessionId, messages = []) {
  lastSavedOriginals.set(sessionId, Array.isArray(messages) ? messages.slice() : []);
  lastSavedCounts.set(sessionId, Array.isArray(messages) ? messages.length : 0);
}

export function saveSessionToSqlite(session, { writeFrom = 0 } = {}) {
  const db = getGlobalDatabase();
  const { id, createdAt, updatedAt, title, projectDir = '', model = '', mode = '', messages = [], ...state } = session;
  const stateJson = JSON.stringify(state);
  const from = Math.max(0, Math.min(Number(writeFrom) || 0, messages.length));
  transaction(db, () => {
    db.prepare(`
      INSERT INTO sessions(id, created_at, updated_at, title, project_dir, model, mode, state_json, message_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        title = excluded.title,
        project_dir = excluded.project_dir,
        model = excluded.model,
        mode = excluded.mode,
        state_json = excluded.state_json,
        message_count = excluded.message_count
    `).run(id, createdAt, updatedAt, title, projectDir, model, mode, stateJson, messages.length);

    const upsert = db.prepare(`
      INSERT INTO session_messages(session_id, ordinal, role, content_text, payload_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_id, ordinal) DO UPDATE SET
        role = excluded.role,
        content_text = excluded.content_text,
        payload_json = excluded.payload_json
      WHERE session_messages.payload_json <> excluded.payload_json
    `);
    for (let ordinal = from; ordinal < messages.length; ordinal += 1) {
      const message = messages[ordinal];
      upsert.run(id, ordinal, String(message?.role || ''), messageText(message?.content), JSON.stringify(message));
    }
    const previousCount = lastSavedCounts.get(id);
    // Only trim the tail when the message list actually shrank; unknown previous
    // count (direct saves without rememberSessionMessageRefs) keeps the old
    // always-delete behavior to stay safe.
    if (previousCount === undefined || messages.length < previousCount) {
      db.prepare('DELETE FROM session_messages WHERE session_id = ? AND ordinal >= ?').run(id, messages.length);
    }
  });
  return session;
}

export function loadSessionFromSqlite(sessionId) {
  const db = getGlobalDatabase();
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!row) return null;
  const state = parseJson(row.state_json, {});
  const messages = db.prepare(`
    SELECT payload_json FROM session_messages WHERE session_id = ? ORDER BY ordinal
  `).all(sessionId).map((entry) => parseJson(entry.payload_json, null)).filter(Boolean);
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    title: row.title,
    ...(row.project_dir ? { projectDir: row.project_dir } : {}),
    ...(row.model ? { model: row.model } : {}),
    ...(row.mode ? { mode: row.mode } : {}),
    ...state,
    messages
  };
}

export function listSessionsFromSqlite(limit = 30, { includeEmpty = false } = {}) {
  const db = getGlobalDatabase();
  const where = includeEmpty ? '' : 'WHERE s.message_count > 0';
  return db.prepare(`
    SELECT s.id, s.title, s.updated_at, s.message_count, s.project_dir, s.model, s.mode,
      COALESCE(substr(replace(replace(m.content_text, char(10), ' '), char(13), ' '), 1, 80), '') AS preview
    FROM sessions s
    LEFT JOIN (
      SELECT session_id, MAX(ordinal) AS max_ordinal
      FROM session_messages
      GROUP BY session_id
    ) last ON last.session_id = s.id
    LEFT JOIN session_messages m ON m.session_id = s.id AND m.ordinal = last.max_ordinal
    ${where}
    ORDER BY s.updated_at DESC
    LIMIT ?
  `).all(Math.max(1, Number(limit || 30))).map((row) => ({
    id: row.id,
    title: row.title,
    updatedAt: row.updated_at,
    messageCount: row.message_count,
    preview: row.preview,
    projectDir: row.project_dir,
    model: row.model,
    mode: row.mode
  }));
}

export function deleteSessionFromSqlite(sessionId) {
  forgetSessionMessageRefs(sessionId);
  const result = getGlobalDatabase().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  getGlobalDatabase().prepare('DELETE FROM runtime_status WHERE session_id = ?').run(sessionId);
  return Number(result.changes || 0) > 0;
}

export function pruneSessionsFromSqlite({ maxSessions = 100, retentionDays = 30 } = {}) {
  const db = getGlobalDatabase();
  const rows = db.prepare('SELECT id, updated_at FROM sessions ORDER BY updated_at DESC').all();
  const cutoff = Date.now() - Math.max(0, Number(retentionDays || 0)) * 86400000;
  const remove = rows.filter((row, index) =>
    index >= Math.max(1, Number(maxSessions || 100)) ||
    (retentionDays > 0 && (Date.parse(row.updated_at) || 0) < cutoff)
  );
  transaction(db, () => {
    const statement = db.prepare('DELETE FROM sessions WHERE id = ?');
    for (const row of remove) {
      forgetSessionMessageRefs(row.id);
      statement.run(row.id);
    }
  });
  return remove.length;
}

export function saveUiTranscriptToSqlite(sessionId, messages = []) {
  const db = getGlobalDatabase();
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`
      INSERT INTO sessions(id, created_at, updated_at, title, state_json, message_count)
      VALUES (?, ?, ?, '新会话', '{}', 0)
      ON CONFLICT(id) DO NOTHING
    `).run(sessionId, now, now);
    const upsert = db.prepare(`
      INSERT INTO ui_messages(session_id, ordinal, message_id, role, payload_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_id, ordinal) DO UPDATE SET
        message_id = excluded.message_id,
        role = excluded.role,
        payload_json = excluded.payload_json
      WHERE ui_messages.payload_json <> excluded.payload_json
    `);
    for (let ordinal = 0; ordinal < messages.length; ordinal += 1) {
      const message = messages[ordinal];
      upsert.run(sessionId, ordinal, String(message?.id || ''), String(message?.role || ''), JSON.stringify(message));
    }
    db.prepare('DELETE FROM ui_messages WHERE session_id = ? AND ordinal >= ?').run(sessionId, messages.length);
  });
}

export function loadUiTranscriptFromSqlite(sessionId) {
  const rows = getGlobalDatabase().prepare(`
    SELECT payload_json FROM ui_messages WHERE session_id = ? ORDER BY ordinal
  `).all(sessionId);
  if (!rows.length) return null;
  return rows.map((row) => parseJson(row.payload_json, null)).filter(Boolean);
}

/** True when a session still has persisted UI-transcript rows (display content). */
export function hasUiTranscriptInSqlite(sessionId) {
  const row = getGlobalDatabase().prepare(`
    SELECT COUNT(*) AS count FROM ui_messages WHERE session_id = ?
  `).get(String(sessionId || ''));
  return Number(row?.count || 0) > 0;
}
