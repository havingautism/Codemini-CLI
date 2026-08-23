import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { sha256 } from './crypto-utils.js';
import { getBaseConfigDir, getMemoryDir, getProjectIndexDir, getProjectMemoryDir } from './paths.js';
import { getGlobalDatabase, getProjectDatabase, transaction } from './sqlite-database.js';
import {
  inferMemoryFamily,
  normalizeMemoryKind,
  normalizeMemoryScope,
  normalizeMemoryText,
  summarizeMemoryContent
} from './memory-policy.js';

export const IMPORT_KEY = 'persistent_memory_json_imported_v1';

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function nowIso() {
  return new Date().toISOString();
}

function tagsText(tags) {
  return Array.isArray(tags) ? tags.map((tag) => String(tag || '').trim()).filter(Boolean).join(' ') : '';
}

export function dbForScope(scope, workspaceRoot = process.cwd(), { create = true } = {}) {
  return scope === 'project'
    ? getProjectDatabase(workspaceRoot, { create })
    : getGlobalDatabase({ create });
}

export function rowToMemoryItem(row, projectKey = '') {
  const tags = parseJson(row?.tags_json, []);
  const evidence = parseJson(row?.evidence_json, {});
  const hitCount = Number(row?.hit_count || 0);
  return {
    id: String(row.id),
    scope: row.scope,
    family: row.family,
    kind: row.kind,
    ...(row.semantic_key ? { semanticKey: row.semantic_key } : {}),
    content: row.content,
    summary: row.summary,
    lifecycle: row.lifecycle,
    confidence: Number(row.confidence),
    utilityScore: Number(row.utility_score),
    source: row.source,
    ...(row.source_session_id ? { sourceSessionId: row.source_session_id } : {}),
    ...(row.tool_name ? { toolName: row.tool_name } : {}),
    ...(row.environment_key ? { environmentKey: row.environment_key } : {}),
    tags: Array.isArray(tags) ? tags : [],
    evidence: evidence && typeof evidence === 'object' && !Array.isArray(evidence) ? evidence : {},
    hitCount,
    hits: hitCount,
    successCount: Number(row.success_count || 0),
    failureCount: Number(row.failure_count || 0),
    pinned: Number(row.pinned) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.last_hit_at ? { lastHitAt: row.last_hit_at } : {}),
    ...(projectKey ? { projectKey } : {})
  };
}

export function normalizePersistentMemory(item, scope, projectKey = '') {
  const now = nowIso();
  const content = normalizeMemoryText(item?.content || '');
  const kind = normalizeMemoryKind(item?.kind, 'note');
  const normalizedScope = normalizeMemoryScope(scope || item?.scope, { fallback: 'project' });
  const tags = Array.isArray(item?.tags) ? item.tags.map((tag) => String(tag || '').trim()).filter(Boolean) : [];
  const evidence = item?.evidence && typeof item.evidence === 'object' && !Array.isArray(item.evidence)
    ? item.evidence
    : {};
  const hitCount = Number.isFinite(Number(item?.hitCount ?? item?.hits)) ? Number(item.hitCount ?? item.hits) : 0;
  return {
    id: String(item?.id || `mem_${sha256(`${normalizedScope}:${projectKey}:${content}:${now}:${Math.random()}`).slice(0, 12)}`),
    scope: normalizedScope,
    family: inferMemoryFamily({
      family: item?.family,
      scope: normalizedScope,
      kind,
      content,
      summary: item?.summary
    }),
    kind,
    ...(normalizeMemoryText(item?.semanticKey) ? { semanticKey: normalizeMemoryText(item.semanticKey).slice(0, 160) } : {}),
    content,
    summary: normalizeMemoryText(item?.summary || summarizeMemoryContent(content)),
    lifecycle: String(item?.lifecycle || 'operational'),
    confidence: Number.isFinite(Number(item?.confidence)) ? Number(item.confidence) : 0.9,
    utilityScore: Number.isFinite(Number(item?.utilityScore)) ? Number(item.utilityScore) : 0.5,
    source: String(item?.source || 'tool').trim() || 'tool',
    ...(normalizeMemoryText(item?.sourceSessionId) ? { sourceSessionId: String(item.sourceSessionId).slice(0, 120) } : {}),
    ...(normalizeMemoryText(item?.toolName) ? { toolName: String(item.toolName).slice(0, 80) } : {}),
    ...(normalizeMemoryText(item?.environmentKey) ? { environmentKey: String(item.environmentKey).slice(0, 80) } : {}),
    tags,
    evidence,
    hitCount,
    hits: hitCount,
    successCount: Number.isFinite(Number(item?.successCount)) ? Number(item.successCount) : 0,
    failureCount: Number.isFinite(Number(item?.failureCount)) ? Number(item.failureCount) : 0,
    pinned: item?.pinned === true,
    createdAt: String(item?.createdAt || now),
    updatedAt: String(item?.updatedAt || now),
    ...(item?.lastHitAt ? { lastHitAt: String(item.lastHitAt) } : {}),
    ...(projectKey ? { projectKey } : {})
  };
}

function syncFts(db, item) {
  db.prepare('DELETE FROM memory_fts WHERE id = ?').run(item.id);
  if (!item?.content && !item?.summary) return;
  db.prepare(`
    INSERT INTO memory_fts(id, summary, content, tags, tool_name)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    item.id,
    String(item.summary || ''),
    String(item.content || ''),
    tagsText(item.tags),
    String(item.toolName || '')
  );
}

export function upsertMemory(db, item) {
  db.prepare(`
    INSERT INTO memories(
      id, scope, family, kind, semantic_key, content, summary, lifecycle,
      confidence, utility_score, source, source_session_id, tool_name, environment_key,
      tags_json, evidence_json, hit_count, success_count, failure_count, pinned,
      created_at, updated_at, last_hit_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      scope = excluded.scope,
      family = excluded.family,
      kind = excluded.kind,
      semantic_key = excluded.semantic_key,
      content = excluded.content,
      summary = excluded.summary,
      lifecycle = excluded.lifecycle,
      confidence = excluded.confidence,
      utility_score = excluded.utility_score,
      source = excluded.source,
      source_session_id = excluded.source_session_id,
      tool_name = excluded.tool_name,
      environment_key = excluded.environment_key,
      tags_json = excluded.tags_json,
      evidence_json = excluded.evidence_json,
      hit_count = excluded.hit_count,
      success_count = excluded.success_count,
      failure_count = excluded.failure_count,
      pinned = excluded.pinned,
      updated_at = excluded.updated_at,
      last_hit_at = excluded.last_hit_at
  `).run(
    item.id,
    item.scope,
    item.family,
    item.kind,
    item.semanticKey || '',
    item.content,
    item.summary,
    item.lifecycle || 'operational',
    item.confidence,
    item.utilityScore,
    item.source,
    item.sourceSessionId || '',
    item.toolName || '',
    item.environmentKey || '',
    JSON.stringify(item.tags || []),
    JSON.stringify(item.evidence && typeof item.evidence === 'object' ? item.evidence : {}),
    item.hitCount || 0,
    item.successCount || 0,
    item.failureCount || 0,
    item.pinned ? 1 : 0,
    item.createdAt,
    item.updatedAt,
    item.lastHitAt || null
  );
  syncFts(db, item);
  return item;
}

export function deleteMemory(db, id) {
  db.prepare('DELETE FROM memory_fts WHERE id = ?').run(id);
  return Number(db.prepare('DELETE FROM memories WHERE id = ?').run(id).changes || 0);
}

export function listMemoriesFromDb(db, { scope, family } = {}) {
  const clauses = [];
  const params = [];
  if (scope && scope !== 'all') {
    clauses.push('scope = ?');
    params.push(scope);
  }
  if (family) {
    clauses.push('family = ?');
    params.push(family);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`
    SELECT * FROM memories ${where}
    ORDER BY updated_at DESC, id DESC
  `).all(...params).map((row) => rowToMemoryItem(row));
}

export function ftsQuery(query) {
  const tokens = String(query || '')
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 || /^[\p{Script=Han}]$/u.test(token))
    .slice(0, 12)
    .map((token) => `"${token.replace(/"/g, '')}"`);
  return tokens.join(' OR ');
}

export function searchFts(db, { query, scope, family, kind, limit = 30 } = {}) {
  const match = ftsQuery(query);
  if (!match) return [];
  const clauses = ['memory_fts MATCH ?'];
  const params = [match];
  if (scope && scope !== 'all') {
    clauses.push('memories.scope = ?');
    params.push(scope);
  }
  if (family) {
    clauses.push('memories.family = ?');
    params.push(family);
  }
  if (kind) {
    clauses.push('memories.kind = ?');
    params.push(kind);
  }
  params.push(Math.max(1, Math.min(50, Number(limit) || 30)));
  try {
    return db.prepare(`
      SELECT memories.*, bm25(memory_fts) AS fts_rank
      FROM memory_fts
      JOIN memories ON memories.id = memory_fts.id
      WHERE ${clauses.join(' AND ')}
      ORDER BY fts_rank
      LIMIT ?
    `).all(...params).map((row) => {
      const item = rowToMemoryItem(row);
      item.ftsRank = Number(row.fts_rank);
      return item;
    });
  } catch {
    return [];
  }
}

export function replaceScopeMemories(db, scope, items = []) {
  const existing = listMemoriesFromDb(db, { scope });
  const keepIds = new Set(items.map((item) => item.id));
  for (const item of existing) {
    if (!keepIds.has(item.id)) deleteMemory(db, item.id);
  }
  for (const item of items) upsertMemory(db, item);
}

export function getMaintenance(db, scope) {
  const row = db.prepare('SELECT value FROM schema_meta WHERE key = ?').get(`memory_maintained_${scope}`);
  return parseJson(row?.value, null);
}

export function setMaintenance(db, scope, meta) {
  db.prepare(`
    INSERT INTO schema_meta(key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(`memory_maintained_${scope}`, JSON.stringify(meta || {}));
}

export function recordMemoryHits(db, ids = []) {
  const now = nowIso();
  const stmt = db.prepare(`
    UPDATE memories
    SET hit_count = hit_count + 1, last_hit_at = ?
    WHERE id = ?
  `);
  for (const id of ids) stmt.run(now, id);
}

async function readJsonBucket(filePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return {
      items: Array.isArray(parsed?.items) ? parsed.items : [],
      maintenance: parsed?.maintenance && typeof parsed.maintenance === 'object' ? parsed.maintenance : null
    };
  } catch {
    return { items: [], maintenance: null };
  }
}

function writeImportedItems(db, items, scope, projectKey = '') {
  for (const raw of items) {
    const item = normalizePersistentMemory(raw, scope, projectKey);
    if (!item.content) continue;
    upsertMemory(db, item);
  }
}

async function importGlobalJson() {
  const dir = getMemoryDir();
  const dbPath = path.join(getBaseConfigDir(), 'codemini.sqlite');
  const hasLegacy = fsSync.existsSync(path.join(dir, 'user.json')) || fsSync.existsSync(path.join(dir, 'global.json'));
  if (!hasLegacy && !fsSync.existsSync(dbPath)) return;
  const db = getGlobalDatabase();
  if (db.prepare('SELECT 1 FROM schema_meta WHERE key = ?').get(IMPORT_KEY)) return;
  const [userDoc, globalDoc] = await Promise.all([
    readJsonBucket(path.join(dir, 'user.json')),
    readJsonBucket(path.join(dir, 'global.json'))
  ]);
  transaction(db, () => {
    writeImportedItems(db, userDoc.items, 'user');
    writeImportedItems(db, globalDoc.items, 'global');
    if (userDoc.maintenance) setMaintenance(db, 'user', userDoc.maintenance);
    if (globalDoc.maintenance) setMaintenance(db, 'global', globalDoc.maintenance);
    db.prepare('INSERT OR IGNORE INTO schema_meta(key, value) VALUES (?, ?)').run(IMPORT_KEY, nowIso());
  });
}

async function importProjectJson(workspaceRoot) {
  const dir = getProjectMemoryDir(workspaceRoot);
  const dbPath = path.join(getProjectIndexDir(workspaceRoot), 'index.sqlite');
  let hasLegacy = false;
  try {
    hasLegacy = (await fs.readdir(dir)).some((name) => name.endsWith('.json'));
  } catch {
    hasLegacy = false;
  }
  if (!hasLegacy && !fsSync.existsSync(dbPath)) return;
  const db = getProjectDatabase(workspaceRoot);
  if (db.prepare('SELECT 1 FROM schema_meta WHERE key = ?').get(IMPORT_KEY)) return;
  let files = [];
  try {
    files = (await fs.readdir(dir))
      .filter((name) => name.endsWith('.json'))
      .map((name) => path.join(dir, name));
  } catch {
    files = [];
  }
  const docs = await Promise.all(files.map((file) => readJsonBucket(file)));
  const items = docs.flatMap((doc) => doc.items);
  const maintenance = docs.find((doc) => doc.maintenance)?.maintenance || null;
  transaction(db, () => {
    writeImportedItems(db, items, 'project');
    if (maintenance) setMaintenance(db, 'project', maintenance);
    db.prepare('INSERT OR IGNORE INTO schema_meta(key, value) VALUES (?, ?)').run(IMPORT_KEY, nowIso());
  });
}

const importLocks = new Map();

export async function ensurePersistentMemoryImported({ workspaceRoot = process.cwd(), scope = '' } = {}) {
  const normalized = scope ? normalizeMemoryScope(scope, { fallback: '' }) : '';
  const jobs = [];
  if (!normalized || normalized === 'user' || normalized === 'global') {
    jobs.push({
      key: `global:${path.resolve(getBaseConfigDir())}`,
      run: importGlobalJson
    });
  }
  if (!normalized || normalized === 'project') {
    const root = path.resolve(workspaceRoot || process.cwd());
    jobs.push({
      key: `project:${root}`,
      run: () => importProjectJson(workspaceRoot)
    });
  }
  await Promise.all(jobs.map(({ key, run }) => {
    const pending = importLocks.get(key) || run();
    importLocks.set(key, pending.catch(() => {}));
    return pending;
  }));
}
