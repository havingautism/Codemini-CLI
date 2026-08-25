import { dbForScope } from './memory-sqlite-store.js';

export const MEMORY_METRIC_NAMES = Object.freeze([
  'retrieval_hits',
  'retrieval_misses',
  'fts_fallback_count',
  'index_rebuild_count',
  'candidate_count',
  'promotion_count',
  'archive_count',
  'eviction_count',
  'experience_episode_count',
  'experience_recovery_count',
  'experience_verified_count',
  'lesson_generated_count',
  'lesson_reused_count',
  'confirmation_count',
  'invalidated_memory_count'
]);

function normalizedScope(scope) {
  return ['user', 'global', 'project'].includes(String(scope || '')) ? String(scope) : 'project';
}

function metricKey(scope, name) {
  return `memory_metric:${normalizedScope(scope)}:${name}`;
}

export function incrementMemoryMetric({
  name,
  scope = 'project',
  workspaceRoot = process.cwd(),
  delta = 1
} = {}) {
  if (!MEMORY_METRIC_NAMES.includes(String(name || ''))) return 0;
  const amount = Math.max(0, Math.floor(Number(delta) || 0));
  if (!amount) return 0;
  try {
    const normalized = normalizedScope(scope);
    const db = dbForScope(normalized, workspaceRoot);
    const key = metricKey(normalized, name);
    db.prepare(`
      INSERT INTO schema_meta(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = CAST(CAST(schema_meta.value AS INTEGER) + ? AS TEXT)
    `).run(key, String(amount), amount);
    return amount;
  } catch {
    return 0;
  }
}

function emptyCounters() {
  return Object.fromEntries(MEMORY_METRIC_NAMES.map((name) => [name, 0]));
}

function readScopeMetrics(scope, workspaceRoot) {
  const counters = emptyCounters();
  const db = dbForScope(scope, workspaceRoot, { create: false });
  if (!db) return { scope, memory_total: 0, active_memory_total: 0, archived_memory_total: 0, ...counters };
  const prefix = `memory_metric:${scope}:`;
  for (const row of db.prepare('SELECT key, value FROM schema_meta WHERE key LIKE ?').all(`${prefix}%`)) {
    const name = String(row.key).slice(prefix.length);
    if (name in counters) counters[name] = Math.max(0, Number(row.value) || 0);
  }
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS memory_total,
      SUM(CASE WHEN lifecycle = 'archived' THEN 0 ELSE 1 END) AS active_memory_total,
      SUM(CASE WHEN lifecycle = 'archived' THEN 1 ELSE 0 END) AS archived_memory_total
    FROM memories WHERE scope = ?
  `).get(scope) || {};
  return {
    scope,
    memory_total: Number(totals.memory_total || 0),
    active_memory_total: Number(totals.active_memory_total || 0),
    archived_memory_total: Number(totals.archived_memory_total || 0),
    ...counters
  };
}

export function getMemoryMetrics({ scope = 'all', workspaceRoot = process.cwd() } = {}) {
  const requested = ['user', 'global', 'project'].includes(String(scope || ''))
    ? [String(scope)]
    : ['user', 'global', 'project'];
  const buckets = requested.map((itemScope) => readScopeMetrics(itemScope, workspaceRoot));
  const totals = { memory_total: 0, active_memory_total: 0, archived_memory_total: 0, ...emptyCounters() };
  for (const bucket of buckets) {
    for (const key of Object.keys(totals)) totals[key] += Number(bucket[key] || 0);
  }
  return { scope: requested.length === 1 ? requested[0] : 'all', ...totals, buckets };
}
