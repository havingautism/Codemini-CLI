import { getGlobalDatabase, transaction } from './sqlite-database.js';

function parseJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}

export function readRuntimeStatuses() {
  return Object.fromEntries(getGlobalDatabase().prepare(
    'SELECT session_id, status, updated_at FROM runtime_status'
  ).all().map((row) => [row.session_id, { status: row.status, updatedAt: row.updated_at }]));
}

export function setRuntimeStatus(sessionId, status, updatedAt = new Date().toISOString()) {
  getGlobalDatabase().prepare(`
    INSERT INTO runtime_status(session_id, status, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
  `).run(sessionId, status, updatedAt);
}

export function removeRuntimeStatus(sessionId) {
  getGlobalDatabase().prepare('DELETE FROM runtime_status WHERE session_id = ?').run(sessionId);
}

export function recoverRuntimeStatuses(statuses = []) {
  const db = getGlobalDatabase();
  const recovered = [];
  transaction(db, () => {
    const rows = db.prepare(`
      SELECT session_id FROM runtime_status WHERE status IN (${statuses.map(() => '?').join(',')})
    `).all(...statuses);
    const update = db.prepare("UPDATE runtime_status SET status = 'interrupted', updated_at = ? WHERE session_id = ?");
    const now = new Date().toISOString();
    for (const row of rows) {
      update.run(now, row.session_id);
      recovered.push(row.session_id);
    }
  });
  return recovered;
}

export function saveAttachmentMetadata(sessionId, metadata) {
  getGlobalDatabase().prepare(`
    INSERT INTO attachments(id, session_id, created_at, path, payload_json)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(session_id, id) DO UPDATE SET
      created_at = excluded.created_at, path = excluded.path, payload_json = excluded.payload_json
  `).run(
    metadata.id, sessionId, metadata.uploadedAt || new Date().toISOString(),
    metadata.path, JSON.stringify(metadata)
  );
  return metadata;
}

export function loadAttachmentMetadata(sessionId, id) {
  const row = getGlobalDatabase().prepare(
    'SELECT payload_json FROM attachments WHERE session_id = ? AND id = ?'
  ).get(sessionId, id);
  return parseJson(row?.payload_json);
}
