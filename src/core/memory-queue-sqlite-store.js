import fs from 'node:fs/promises';
import path from 'node:path';
import { getArchiveDir, getInboxDir } from './paths.js';
import { getGlobalDatabase, transaction } from './sqlite-database.js';

const IMPORT_KEY = 'memory_queue_json_imported';

function parseJson(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function dayForEntry(entry, bucket) {
  const stamp = bucket === 'archive' ? entry?.archivedAt : entry?.timestamp;
  return String(stamp || new Date().toISOString()).slice(0, 10);
}

function putEntry(db, bucket, entry) {
  db.prepare(`
    INSERT INTO memory_queue_entries(id, bucket, day, scope, created_at, idempotency_key, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      bucket = excluded.bucket, day = excluded.day, scope = excluded.scope,
      created_at = excluded.created_at, idempotency_key = excluded.idempotency_key,
      payload_json = excluded.payload_json
  `).run(
    String(entry.id), bucket, dayForEntry(entry, bucket), String(entry.scope || ''),
    String(entry.timestamp || entry.archivedAt || ''), String(entry.idempotencyKey || ''), JSON.stringify(entry)
  );
}

async function readLegacyBucket(baseDir, bucket) {
  const collected = [];
  let days = [];
  try { days = (await fs.readdir(baseDir)).filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)); } catch {}
  for (const day of days) {
    try {
      const entries = JSON.parse(await fs.readFile(path.join(baseDir, day, 'index.json'), 'utf8'));
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) if (entry?.id) collected.push({ bucket, entry });
    } catch {}
  }
  return collected;
}

export async function ensureMemoryQueueImported() {
  const db = getGlobalDatabase();
  if (db.prepare('SELECT 1 FROM schema_meta WHERE key = ?').get(IMPORT_KEY)) return;
  const legacyEntries = [
    ...await readLegacyBucket(getInboxDir(), 'inbox'),
    ...await readLegacyBucket(getArchiveDir(), 'archive')
  ];
  transaction(db, () => {
    for (const { bucket, entry } of legacyEntries) putEntry(db, bucket, entry);
    db.prepare('INSERT OR IGNORE INTO schema_meta(key, value) VALUES (?, ?)').run(IMPORT_KEY, new Date().toISOString());
  });
}

export function findInboxByIdempotencyKey(key) {
  if (!key) return null;
  const row = getGlobalDatabase().prepare(`
    SELECT payload_json FROM memory_queue_entries
    WHERE bucket = 'inbox' AND idempotency_key = ?
  `).get(key);
  return parseJson(row?.payload_json);
}

export function saveMemoryQueueEntry(bucket, entry) {
  try {
    putEntry(getGlobalDatabase(), bucket, entry);
  } catch (error) {
    if (bucket === 'inbox' && entry?.idempotencyKey && String(error?.code || '').startsWith('ERR_SQLITE_CONSTRAINT')) {
      const existing = findInboxByIdempotencyKey(entry.idempotencyKey);
      if (existing) return { ...existing, duplicate: true };
    }
    throw error;
  }
  return entry;
}

export function listMemoryQueueEntries(bucket, { since, scope } = {}) {
  const clauses = ['bucket = ?'];
  const params = [bucket];
  if (since) { clauses.push('day >= ?'); params.push(String(since).slice(0, 10)); }
  if (scope) { clauses.push('scope = ?'); params.push(String(scope)); }
  return getGlobalDatabase().prepare(`
    SELECT payload_json FROM memory_queue_entries
    WHERE ${clauses.join(' AND ')}
    ORDER BY day, created_at, id
  `).all(...params).map((row) => parseJson(row.payload_json)).filter(Boolean);
}

export function updateInboxEntryInSqlite(id, updates = {}) {
  const db = getGlobalDatabase();
  const row = db.prepare("SELECT payload_json FROM memory_queue_entries WHERE id = ? AND bucket = 'inbox'").get(id);
  const current = parseJson(row?.payload_json);
  if (!current) return null;
  const next = { ...current, ...updates };
  putEntry(db, 'inbox', next);
  return next;
}

export function removeInboxEntryFromSqlite(id) {
  return Number(getGlobalDatabase().prepare(
    "DELETE FROM memory_queue_entries WHERE id = ? AND bucket = 'inbox'"
  ).run(id).changes || 0) > 0;
}

export function pruneMemoryQueueArchive({ olderThanDays = 90 } = {}) {
  const days = Math.max(0, Math.floor(Number(olderThanDays) || 90));
  const result = getGlobalDatabase().prepare(`
    DELETE FROM memory_queue_entries
    WHERE bucket = 'archive' AND day < date('now', ?)
  `).run(`-${days} days`);
  return Number(result.changes || 0);
}

export function archiveMemoryQueueEntry(entry, archived) {
  const db = getGlobalDatabase();
  transaction(db, () => {
    putEntry(db, 'archive', archived);
    db.prepare("DELETE FROM memory_queue_entries WHERE id = ? AND bucket = 'inbox'").run(entry.id);
  });
  // Best-effort archive-bucket pruning; archiving must never fail because of it.
  try {
    pruneMemoryQueueArchive();
  } catch {
    // Ignore prune failures.
  }
  return archived;
}
