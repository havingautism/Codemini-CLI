import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { sha256 } from './crypto-utils.js';
import { getBaseConfigDir, getMemoryDir, getProjectIndexDir, getProjectMemoryDir } from './paths.js';
import { getGlobalDatabase, getProjectDatabase, transaction } from './sqlite-database.js';
import {
  inferMemoryFamily,
  nextLifecycleFromCounts,
  nextUtilityFromCounts,
  normalizeMemoryKind,
  normalizeMemoryScope,
  normalizeMemoryText,
  segmentSearchText,
  summarizeMemoryContent
} from './memory-policy.js';

export const IMPORT_KEY = 'persistent_memory_json_imported_v1';

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function nowIso() {
  return new Date().toISOString();
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
  const confirmationCount = Number(row?.confirmation_count || 0);
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
    ...(row.source_branch_id ? { sourceBranchId: row.source_branch_id } : {}),
    ...(row.tool_name ? { toolName: row.tool_name } : {}),
    ...(row.environment_key ? { environmentKey: row.environment_key } : {}),
    ...(row.agent_role && row.agent_role !== '*' ? { agentRole: row.agent_role } : {}),
    ...(Number.isFinite(Number(row.expected_valid_days)) ? { expectedValidDays: Number(row.expected_valid_days) } : {}),
    tags: Array.isArray(tags) ? tags : [],
    evidence: evidence && typeof evidence === 'object' && !Array.isArray(evidence) ? evidence : {},
    hitCount,
    hits: hitCount,
    accessCount: Number(row?.access_count ?? row?.hit_count ?? 0),
    confirmationCount,
    successCount: Number(row.success_count || 0),
    failureCount: Number(row.failure_count || 0),
    pinned: Number(row.pinned) === 1,
    revision: Number(row.revision || 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.last_hit_at ? { lastHitAt: row.last_hit_at } : {}),
    ...(row.last_accessed_at || row.last_hit_at ? { lastAccessedAt: row.last_accessed_at || row.last_hit_at } : {}),
    ...(row.last_confirmed_at ? { lastConfirmedAt: row.last_confirmed_at } : {}),
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
    ...(normalizeMemoryText(item?.sourceBranchId) ? { sourceBranchId: String(item.sourceBranchId).slice(0, 120) } : {}),
    ...(normalizeMemoryText(item?.toolName) ? { toolName: String(item.toolName).slice(0, 80) } : {}),
    ...(normalizeMemoryText(item?.environmentKey) ? { environmentKey: String(item.environmentKey).slice(0, 80) } : {}),
    ...(normalizeMemoryText(item?.agentRole) ? { agentRole: String(item.agentRole).slice(0, 40) } : {}),
    ...(Number.isFinite(Number(item?.expectedValidDays)) ? { expectedValidDays: Math.max(0, Math.floor(Number(item.expectedValidDays))) } : {}),
    tags,
    evidence,
    hitCount,
    hits: hitCount,
    accessCount: Number.isFinite(Number(item?.accessCount ?? item?.hitCount ?? item?.hits))
      ? Number(item.accessCount ?? item.hitCount ?? item.hits)
      : 0,
    confirmationCount: Number.isFinite(Number(item?.confirmationCount)) ? Number(item.confirmationCount) : 0,
    successCount: Number.isFinite(Number(item?.successCount)) ? Number(item.successCount) : 0,
    failureCount: Number.isFinite(Number(item?.failureCount)) ? Number(item.failureCount) : 0,
    pinned: item?.pinned === true,
    revision: Math.max(1, Number(item?.revision || 1)),
    createdAt: String(item?.createdAt || now),
    updatedAt: String(item?.updatedAt || now),
    ...(item?.lastHitAt ? { lastHitAt: String(item.lastHitAt) } : {}),
    ...(item?.lastAccessedAt ? { lastAccessedAt: String(item.lastAccessedAt) } : {}),
    ...(item?.lastConfirmedAt ? { lastConfirmedAt: String(item.lastConfirmedAt) } : {}),
    ...(projectKey ? { projectKey } : {})
  };
}

export function syncMemoryFts(db, item) {
  return syncFts(db, item);
}

function syncFts(db, item) {
  db.prepare('DELETE FROM memory_fts WHERE id = ?').run(item.id);
  const rawContent = String(item.content || '');
  const rawText = [item.summary, rawContent].filter(Boolean).join(' ');
  if (!rawText) return;
  db.prepare(`
    INSERT INTO memory_fts(id, search_text, raw_content, tool_name)
    VALUES (?, ?, ?, ?)
  `).run(
    item.id,
    segmentSearchText(rawText),
    rawContent,
    String(item.toolName || '')
  );
}

export function upsertMemory(db, item) {
  db.prepare(`
    INSERT INTO memories(
      id, scope, family, kind, semantic_key, content, summary, lifecycle,
      confidence, utility_score, source, source_session_id, source_branch_id,
      tool_name, environment_key, agent_role, expected_valid_days,
      tags_json, evidence_json, hit_count, access_count, success_count, failure_count,
      pinned, confirmation_count, last_confirmed_at, last_accessed_at, revision,
      created_at, updated_at, last_hit_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      source_branch_id = excluded.source_branch_id,
      tool_name = excluded.tool_name,
      environment_key = excluded.environment_key,
      agent_role = excluded.agent_role,
      expected_valid_days = excluded.expected_valid_days,
      tags_json = excluded.tags_json,
      evidence_json = excluded.evidence_json,
      hit_count = excluded.hit_count,
      access_count = excluded.access_count,
      success_count = excluded.success_count,
      failure_count = excluded.failure_count,
      pinned = excluded.pinned,
      confirmation_count = excluded.confirmation_count,
      last_confirmed_at = excluded.last_confirmed_at,
      last_accessed_at = excluded.last_accessed_at,
      revision = memories.revision + 1,
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
    item.sourceBranchId || '',
    item.toolName || '',
    item.environmentKey || '',
    item.agentRole || '*',
    item.expectedValidDays ?? null,
    JSON.stringify(item.tags || []),
    JSON.stringify(item.evidence && typeof item.evidence === 'object' ? item.evidence : {}),
    item.hitCount || 0,
    item.accessCount ?? item.hitCount ?? 0,
    item.successCount || 0,
    item.failureCount || 0,
    item.pinned ? 1 : 0,
    item.confirmationCount || 0,
    item.lastConfirmedAt || null,
    item.lastAccessedAt || null,
    item.revision || 1,
    item.createdAt,
    item.updatedAt,
    item.lastHitAt || null
  );
  try {
    syncFts(db, item);
  } catch {
    // ponytail: canonical write already committed; query path rebuilds FTS
  }
  return item;
}

export function deleteMemory(db, id) {
  const removed = Number(db.prepare('DELETE FROM memories WHERE id = ?').run(id).changes || 0);
  try {
    db.prepare('DELETE FROM memory_fts WHERE id = ?').run(id);
  } catch {
    // next rebuild drops stale FTS rows
  }
  return removed;
}

export function listMemoriesFromDb(db, { scope, family, kind, lifecycle } = {}) {
  const clauses = [];
  const params = [];
  if (scope && scope !== 'all') {
    clauses.push('scope = ?');
    params.push(scope);
  }
  if (family && family !== 'all') {
    clauses.push('family = ?');
    params.push(family);
  }
  if (kind && kind !== 'all') {
    clauses.push('kind = ?');
    params.push(kind);
  }
  if (lifecycle && lifecycle !== 'all') {
    clauses.push('lifecycle = ?');
    params.push(lifecycle);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`
    SELECT * FROM memories ${where}
    ORDER BY updated_at DESC, id DESC
  `).all(...params).map((row) => rowToMemoryItem(row));
}

export function ftsQuery(query) {
  const tokens = queryTokens(query)
    .map((token) => `"${token.replace(/"/g, '')}"`);
  return tokens.join(' OR ');
}

const MEMORY_FTS_DDL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
    id UNINDEXED,
    search_text,
    raw_content UNINDEXED,
    tool_name UNINDEXED,
    tokenize = 'unicode61'
  );
`;

export function rebuildMemoryIndex(db) {
  db.exec('DROP TABLE IF EXISTS memory_fts');
  db.exec(MEMORY_FTS_DDL);
  const insert = db.prepare(`
    INSERT INTO memory_fts(id, search_text, raw_content, tool_name)
    VALUES (?, ?, ?, ?)
  `);
  for (const row of db.prepare('SELECT * FROM memories').all()) {
    const item = rowToMemoryItem(row);
    const rawContent = String(item.content || '');
    const rawText = [item.summary, rawContent].filter(Boolean).join(' ');
    if (!rawText) continue;
    insert.run(item.id, segmentSearchText(rawText), rawContent, String(item.toolName || ''));
  }
}

function queryTokens(query) {
  const segmented = segmentSearchText(query);
  if (!segmented) return [];
  return segmented.split(/\s+/).filter(Boolean).slice(0, 12);
}

function searchSubstring(db, { query, scope, family, kind, limit = 30 } = {}) {
  const tokens = queryTokens(query).map((token) => token.toLowerCase());
  if (!tokens.length) return [];
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
  if (kind) {
    clauses.push('kind = ?');
    params.push(kind);
  }
  clauses.push(`(${tokens.map(() => '(LOWER(content) LIKE ? OR LOWER(summary) LIKE ?)').join(' OR ')})`);
  for (const token of tokens) {
    const like = `%${token.replace(/[%_]/g, '')}%`;
    params.push(like, like);
  }
  params.push(Math.max(1, Math.min(50, Number(limit) || 30)));
  return db.prepare(`
    SELECT * FROM memories
    WHERE ${clauses.join(' AND ')}
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(...params).map((row) => {
    const item = rowToMemoryItem(row);
    item.ftsRank = 0.5;
    return item;
  });
}

function queryFts(db, { query, scope, family, kind, limit = 30 } = {}) {
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
}

export function searchFts(db, options = {}) {
  const rebuild = options.rebuild !== false;
  const fallback = options.fallback !== false;
  try {
    return queryFts(db, options);
  } catch {
    if (rebuild) {
      try {
        rebuildMemoryIndex(db);
        return queryFts(db, options);
      } catch {
        // fall through to substring
      }
    }
    if (fallback) {
      try {
        return searchSubstring(db, options);
      } catch {
        return [];
      }
    }
    return [];
  }
}

function mergeReinforcement(item, existing = []) {
  const prev = existing.find((row) =>
    (item.id && row.id === item.id)
    || (item.semanticKey && row.semanticKey && item.semanticKey === row.semanticKey)
    || (item.content && row.content === item.content)
  );
  if (!prev) return item;
  const successCount = Math.max(Number(item.successCount || 0), Number(prev.successCount || 0));
  const failureCount = Math.max(Number(item.failureCount || 0), Number(prev.failureCount || 0));
  const confirmationCount = Math.max(Number(item.confirmationCount || 0), Number(prev.confirmationCount || 0));
  return {
    ...item,
    id: prev.id,
    hitCount: Math.max(Number(item.hitCount || 0), Number(prev.hitCount || 0)),
    accessCount: Math.max(Number(item.accessCount || item.hitCount || 0), Number(prev.accessCount || prev.hitCount || 0)),
    confirmationCount,
    successCount,
    failureCount,
    revision: Math.max(Number(item.revision || 1), Number(prev.revision || 1)),
    lastConfirmedAt: item.lastConfirmedAt || prev.lastConfirmedAt,
    utilityScore: nextUtilityFromCounts(successCount, failureCount),
    lifecycle: nextLifecycleFromCounts({
      lifecycle: item.lifecycle || prev.lifecycle,
      successCount,
      failureCount,
      confirmationCount,
      pinned: item.pinned === true || prev.pinned === true,
      kind: item.kind || prev.kind
    })
  };
}

export function replaceScopeMemories(db, scope, items = []) {
  const existing = listMemoriesFromDb(db, { scope });
  const merged = items.map((item) => mergeReinforcement(item, existing));
  const keepIds = new Set(merged.map((item) => item.id));
  for (const item of existing) {
    if (!keepIds.has(item.id)) deleteMemory(db, item.id);
  }
  for (const item of merged) upsertMemory(db, item);
}

export function recordMemoryOutcome(db, ids = [], result = 'success') {
  if (!db || !ids.length) return;
  const successDelta = result === 'success' ? 1 : 0;
  const failureDelta = result === 'success' ? 0 : 1;
  const stmt = db.prepare(`
    UPDATE memories SET
      success_count = success_count + ?,
      failure_count = failure_count + ?,
      utility_score = MAX(0.0, MIN(1.0, 0.5 + 0.08 * (success_count + ?) - 0.12 * (failure_count + ?))),
      lifecycle = CASE
        WHEN lifecycle = 'archived' THEN 'archived'
        WHEN failure_count + ? >= 2 AND failure_count + ? >= success_count + ? THEN 'archived'
        ELSE lifecycle
      END
    WHERE id = ?
  `);
  for (const id of ids) {
    stmt.run(successDelta, failureDelta, successDelta, failureDelta, failureDelta, failureDelta, successDelta, id);
  }
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

/**
 * Optimistic update with revision conflict detection (design §39).
 * Bumps revision and updated_at atomically; returns 0 when the revision
 * no longer matches (stale write) so the caller can reload and retry/merge.
 */
const UPDATE_PATCH_COLUMNS = {
  scope: 'scope',
  family: 'family',
  kind: 'kind',
  semanticKey: 'semantic_key',
  content: 'content',
  summary: 'summary',
  lifecycle: 'lifecycle',
  confidence: 'confidence',
  pinned: 'pinned',
  tags: 'tags_json',
  evidence: 'evidence_json',
  toolName: 'tool_name',
  environmentKey: 'environment_key',
  agentRole: 'agent_role',
  expectedValidDays: 'expected_valid_days',
  sourceBranchId: 'source_branch_id'
};

export function updateMemoryWithRevision(db, id, patch = {}, expectedRevision) {
  if (!id) return 0;
  const setClauses = [];
  const params = [];
  for (const [field, column] of Object.entries(UPDATE_PATCH_COLUMNS)) {
    if (!(field in patch)) continue;
    setClauses.push(`${column} = ?`);
    const value = patch[field];
    if (column === 'tags_json') params.push(JSON.stringify(Array.isArray(value) ? value : []));
    else if (column === 'evidence_json') params.push(JSON.stringify(value && typeof value === 'object' && !Array.isArray(value) ? value : {}));
    else if (column === 'pinned') params.push(value ? 1 : 0);
    else params.push(value);
  }
  setClauses.push('revision = revision + 1');
  setClauses.push('updated_at = ?');
  params.push(patch.updatedAt || nowIso());
  const where = expectedRevision == null ? 'id = ?' : 'id = ? AND revision = ?';
  params.push(id);
  if (expectedRevision != null) params.push(Number(expectedRevision));
  return Number(db.prepare(`UPDATE memories SET ${setClauses.join(', ')} WHERE ${where}`).run(...params).changes || 0);
}

export function recordMemoryHits(db, ids = []) {
  const now = nowIso();
  const stmt = db.prepare(`
    UPDATE memories
    SET hit_count = hit_count + 1, last_hit_at = ?,
        access_count = access_count + 1, last_accessed_at = ?
    WHERE id = ?
  `);
  for (const id of ids) stmt.run(now, now, id);
}

export function recordMemoryConfirmation(db, ids = []) {
  if (!db || !ids.length) return;
  const now = nowIso();
  const stmt = db.prepare(`
    UPDATE memories SET
      confirmation_count = confirmation_count + 1,
      last_confirmed_at = ?,
      lifecycle = CASE
        WHEN lifecycle = 'archived' THEN 'archived'
        WHEN pinned = 1 OR kind = 'preference' OR confirmation_count + 1 >= 3 THEN 'longterm'
        ELSE lifecycle
      END
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
