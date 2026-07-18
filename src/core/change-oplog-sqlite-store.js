import { getProjectDatabase } from './sqlite-database.js';

function parseJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}

export function saveChangeOperationToSqlite(projectRoot, operation) {
  getProjectDatabase(projectRoot).prepare(`
    INSERT INTO change_operations(id, session_id, created_at, reverted_at, patch_path, payload_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      session_id = excluded.session_id, created_at = excluded.created_at,
      reverted_at = excluded.reverted_at, patch_path = excluded.patch_path,
      payload_json = excluded.payload_json
  `).run(
    operation.id, operation.sessionId, operation.createdAt, operation.revertedAt || null,
    operation.patchPath, JSON.stringify(operation)
  );
  return operation;
}

export function listChangeOperationsFromSqlite(projectRoot, sessionId) {
  return getProjectDatabase(projectRoot).prepare(`
    SELECT payload_json FROM change_operations
    WHERE session_id = ? ORDER BY created_at DESC
  `).all(sessionId).map((row) => parseJson(row.payload_json)).filter(Boolean);
}

export function loadChangeOperationFromSqlite(projectRoot, operationId) {
  const row = getProjectDatabase(projectRoot).prepare(
    'SELECT payload_json FROM change_operations WHERE id = ?'
  ).get(operationId);
  return parseJson(row?.payload_json);
}
