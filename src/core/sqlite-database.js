import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getBaseConfigDir, getProjectIndexDir } from './paths.js';

const GLOBAL_SCHEMA_VERSION = 5;
const PROJECT_SCHEMA_VERSION = 5;
const databases = new Map();

function configure(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA wal_autocheckpoint = 4096;
    PRAGMA journal_size_limit = 67108864;
    PRAGMA cache_size = -32768;
    PRAGMA mmap_size = 268435456;
    PRAGMA temp_store = MEMORY;
  `);
}

function openDatabase(filePath, schema, version) {
  const resolved = path.resolve(filePath);
  const cached = databases.get(resolved);
  if (cached) return cached;
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new DatabaseSync(resolved);
  configure(db);
  db.exec('CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT');
  const current = Number(db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get()?.value || 0);
  if (current > version) {
    db.close();
    throw new Error(`SQLite schema ${current} is newer than supported schema ${version}: ${resolved}`);
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    schema(db, current);
    db.prepare(`
      INSERT INTO schema_meta(key, value) VALUES ('schema_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(version));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
  databases.set(resolved, db);
  return db;
}

function createGlobalSchema(db, currentVersion = 0) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      title TEXT NOT NULL,
      project_dir TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT '',
      state_json TEXT NOT NULL DEFAULT '{}',
      message_count INTEGER NOT NULL DEFAULT 0
    ) STRICT;
    CREATE INDEX IF NOT EXISTS sessions_updated_idx ON sessions(updated_at DESC);

    CREATE TABLE IF NOT EXISTS session_messages (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      role TEXT NOT NULL,
      content_text TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL,
      PRIMARY KEY(session_id, ordinal)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ui_messages (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      message_id TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL,
      PRIMARY KEY(session_id, ordinal)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS runtime_status (
      session_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS memory_review_jobs (
      session_id TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL DEFAULT '',
      reviewer_version INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      claimed_at TEXT,
      lease_until TEXT,
      reviewed_at TEXT,
      failed_at TEXT,
      next_retry_at TEXT,
      reviewed_message_count INTEGER,
      candidate_count INTEGER,
      last_error TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS memory_queue_entries (
      id TEXT PRIMARY KEY,
      bucket TEXT NOT NULL CHECK(bucket IN ('inbox', 'archive')),
      day TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      idempotency_key TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS memory_queue_list_idx
      ON memory_queue_entries(bucket, day, created_at, id);
    CREATE INDEX IF NOT EXISTS memory_queue_scope_idx
      ON memory_queue_entries(bucket, scope, day, created_at, id);
    CREATE UNIQUE INDEX IF NOT EXISTS memory_queue_idempotency_idx
      ON memory_queue_entries(idempotency_key) WHERE bucket = 'inbox' AND idempotency_key <> '';

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT '',
      path TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY(session_id, id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS scrapbook_entries (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_url TEXT NOT NULL DEFAULT '',
      source_session_id TEXT NOT NULL DEFAULT '',
      source_message_id TEXT NOT NULL DEFAULT '',
      source_question_text TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      content_text TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      fetch_status TEXT NOT NULL DEFAULT 'ready'
    ) STRICT;
    CREATE INDEX IF NOT EXISTS scrapbook_entries_updated_idx
      ON scrapbook_entries(updated_at DESC, created_at DESC);

    CREATE TABLE IF NOT EXISTS scrapbook_summary_jobs (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL REFERENCES scrapbook_entries(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      partial_text TEXT NOT NULL DEFAULT '',
      result_summary TEXT NOT NULL DEFAULT '',
      error_text TEXT NOT NULL DEFAULT ''
    ) STRICT;
    CREATE INDEX IF NOT EXISTS scrapbook_summary_jobs_entry_idx
      ON scrapbook_summary_jobs(entry_id, created_at DESC);
  `);
  if (currentVersion < 2) {
    db.exec(`
      DROP INDEX IF EXISTS sessions_project_updated_idx;
      DROP INDEX IF EXISTS ui_messages_id_idx;
      DROP INDEX IF EXISTS memory_review_retry_idx;
      DROP INDEX IF EXISTS memory_queue_list_idx;
      DROP INDEX IF EXISTS memory_queue_scope_idx;
      CREATE INDEX memory_queue_list_idx
        ON memory_queue_entries(bucket, day, created_at, id);
      CREATE INDEX memory_queue_scope_idx
        ON memory_queue_entries(bucket, scope, day, created_at, id);
    `);
  }
  if (currentVersion < 4) {
    const columns = db
      .prepare(`SELECT name FROM pragma_table_info('scrapbook_summary_jobs')`)
      .all()
      .map((row) => String(row.name || ''));
    if (columns.length > 0 && !columns.includes('error_text')) {
      db.exec(`
        ALTER TABLE scrapbook_summary_jobs
        ADD COLUMN error_text TEXT NOT NULL DEFAULT '';
      `);
    }
  }
  if (currentVersion < 5) {
    const columns = db
      .prepare(`SELECT name FROM pragma_table_info('scrapbook_entries')`)
      .all()
      .map((row) => String(row.name || ''));
    if (columns.length > 0 && !columns.includes('source_session_id')) {
      db.exec(`
        ALTER TABLE scrapbook_entries
        ADD COLUMN source_session_id TEXT NOT NULL DEFAULT '';
      `);
    }
    if (columns.length > 0 && !columns.includes('source_message_id')) {
      db.exec(`
        ALTER TABLE scrapbook_entries
        ADD COLUMN source_message_id TEXT NOT NULL DEFAULT '';
      `);
    }
    if (columns.length > 0 && !columns.includes('source_question_text')) {
      db.exec(`
        ALTER TABLE scrapbook_entries
        ADD COLUMN source_question_text TEXT NOT NULL DEFAULT '';
      `);
    }
  }
}

function createProjectSchema(db, currentVersion = 0) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_metadata (
      key TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS indexed_files (
      file TEXT PRIMARY KEY,
      language TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      mtime_ms INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS indexed_symbols (
      symbol_id TEXT PRIMARY KEY,
      file TEXT NOT NULL REFERENCES indexed_files(file) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT '',
      start_line INTEGER NOT NULL DEFAULT 0,
      end_line INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS indexed_symbols_file_idx ON indexed_symbols(file, start_line);
    CREATE TABLE IF NOT EXISTS knowledge_graph_nodes (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      file TEXT NOT NULL DEFAULT '',
      graph_version TEXT NOT NULL,
      payload_json TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS knowledge_graph_nodes_file_idx
      ON knowledge_graph_nodes(file, type);
    CREATE TABLE IF NOT EXISTS knowledge_graph_edges (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL REFERENCES knowledge_graph_nodes(id) ON DELETE CASCADE,
      target TEXT NOT NULL REFERENCES knowledge_graph_nodes(id) ON DELETE CASCADE,
      relation TEXT NOT NULL,
      confidence TEXT NOT NULL,
      source_file TEXT NOT NULL DEFAULT '',
      graph_version TEXT NOT NULL,
      payload_json TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS knowledge_graph_edges_source_idx
      ON knowledge_graph_edges(source, relation);
    CREATE INDEX IF NOT EXISTS knowledge_graph_edges_target_idx
      ON knowledge_graph_edges(target, relation);
    CREATE TABLE IF NOT EXISTS change_operations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      reverted_at TEXT,
      patch_path TEXT NOT NULL,
      payload_json TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS change_operations_session_idx
      ON change_operations(session_id, created_at DESC);
  `);
  if (currentVersion < 4) {
    db.exec(`
      DROP TABLE IF EXISTS indexed_search;
      DROP INDEX IF EXISTS indexed_files_language_idx;
      DROP INDEX IF EXISTS indexed_symbols_name_idx;
    `);
  }
}

export function getGlobalDatabase() {
  return openDatabase(
    path.join(getBaseConfigDir(), 'codemini.sqlite'),
    createGlobalSchema,
    GLOBAL_SCHEMA_VERSION
  );
}

export function getProjectDatabase(cwd = process.cwd()) {
  return openDatabase(
    path.join(getProjectIndexDir(cwd), 'index.sqlite'),
    createProjectSchema,
    PROJECT_SCHEMA_VERSION
  );
}

export function transaction(db, task) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = task();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function closeSqliteDatabasesForTests() {
  for (const db of databases.values()) db.close();
  databases.clear();
}
