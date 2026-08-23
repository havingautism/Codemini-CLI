import path from 'node:path';
import {
  dbForScope,
  ensurePersistentMemoryImported,
  listMemoriesFromDb,
  recordMemoryHits,
  searchFts
} from './memory-sqlite-store.js';
import {
  familyScore,
  lexicalFromBm25,
  recencyScore,
  scopeScore,
  scoreMemoryHit
} from './memory-ranker.js';
import { inferMemoryFamily, normalizeMemoryFamily, normalizeMemoryScope, normalizeMemoryText } from './memory-policy.js';

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function requestedFamilies(family) {
  if (Array.isArray(family)) {
    return family.map((item) => normalizeMemoryFamily(item, { fallback: '' })).filter(Boolean);
  }
  const single = normalizeMemoryFamily(family, { fallback: '' });
  return single ? [single] : [];
}

function requestedScopes(scope) {
  const raw = String(scope || 'all').trim().toLowerCase();
  if (!raw || raw === 'all') return ['user', 'global', 'project'];
  return [normalizeMemoryScope(raw, { fallback: 'project' })];
}

function recallReason(item, query) {
  const bits = [];
  if (item.toolName) bits.push(item.toolName);
  if (item.environmentKey) bits.push(item.environmentKey);
  if (item.family === 'coding') bits.push('coding lesson');
  if (item.family === 'procedure') bits.push('procedure');
  if (item.family === 'repo') bits.push('repo convention');
  const needle = normalizeMemoryText(query).slice(0, 48);
  if (needle) bits.push(`matched "${needle}"`);
  return bits.join(' · ') || 'related memory';
}

function rankItem(item, { query, scope, families, now }) {
  const lexical = lexicalFromBm25(item.ftsRank ?? 0.4);
  const score = scoreMemoryHit({
    lexicalScore: Number.isFinite(item.ftsRank) ? lexical : 0.35,
    scopeScore: scopeScore(item.scope, scope === 'all' ? item.scope : scope),
    familyScore: familyScore(item.family || inferMemoryFamily(item), families),
    confidence: item.confidence,
    utilityScore: item.utilityScore,
    recencyScore: recencyScore(item.updatedAt, now),
    verifiedRecovery: item.evidence?.successful_recovery === true || Number(item.successCount) >= 3
  });
  return {
    ...item,
    score,
    recallReason: recallReason(item, query)
  };
}

export async function retrieveMemories({
  query = '',
  scope = 'all',
  family,
  kind = '',
  limit,
  workspaceRoot = process.cwd(),
  config = {},
  mode = 'turn'
} = {}) {
  if (config?.memory?.enabled === false || config?.memory?.retrieval?.enabled === false) return [];
  const scopes = requestedScopes(scope);
  const families = requestedFamilies(family);
  const turnLimit = clamp(config?.memory?.retrieval?.turn_limit, 1, 10, 5);
  const toolLimit = clamp(config?.memory?.retrieval?.tool_limit, 1, 10, 3);
  const topK = clamp(limit, 1, 10, mode === 'tool' ? toolLimit : turnLimit);
  const minScore = Number(config?.memory?.retrieval?.min_score ?? 0.2);
  const needle = normalizeMemoryText(query);
  const root = path.resolve(workspaceRoot || process.cwd());

  await Promise.all(scopes.map((itemScope) => ensurePersistentMemoryImported({
    workspaceRoot: root,
    scope: itemScope
  })));

  const searchJobs = [];
  if (scopes.includes('user') || scopes.includes('global')) {
    const globalDb = dbForScope('user', root, { create: false });
    if (globalDb) {
      for (const itemScope of scopes.filter((value) => value === 'user' || value === 'global')) {
        const familyFilter = families.length === 1 ? families[0] : '';
        searchJobs.push(needle
          ? searchFts(globalDb, { query: needle, scope: itemScope, family: familyFilter, kind, limit: 30 })
          : listMemoriesFromDb(globalDb, { scope: itemScope, family: familyFilter }));
      }
    }
  }
  if (scopes.includes('project')) {
    const projectDb = dbForScope('project', root, { create: false });
    if (projectDb) {
      const familyFilter = families.length === 1 ? families[0] : '';
      searchJobs.push(needle
        ? searchFts(projectDb, { query: needle, scope: 'project', family: familyFilter, kind, limit: 30 })
        : listMemoriesFromDb(projectDb, { scope: 'project', family: familyFilter }));
    }
  }

  const chunks = await Promise.all(searchJobs);
  const now = Date.now();
  const seen = new Set();
  const ranked = [];
  for (const item of chunks.flat()) {
    if (seen.has(`${item.scope}:${item.id}`)) continue;
    if (families.length && !families.includes(item.family)) continue;
    if (kind && item.kind !== kind) continue;
    seen.add(`${item.scope}:${item.id}`);
    ranked.push(rankItem(item, { query: needle, scope, families, now }));
  }
  ranked.sort((left, right) => right.score - left.score || String(right.updatedAt).localeCompare(String(left.updatedAt)));
  const hits = ranked.filter((item) => !needle || item.score >= minScore || Number.isFinite(item.ftsRank)).slice(0, topK);

  const grouped = new Map();
  for (const item of hits) {
    const key = item.scope === 'project' ? `project:${root}` : 'global';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item.id);
  }
  Promise.all([...grouped.entries()].map(([key, ids]) => {
    const db = key.startsWith('project:') ? dbForScope('project', root) : dbForScope('user', root);
    try { recordMemoryHits(db, ids); } catch { /* hit counts are best-effort */ }
    return null;
  })).catch(() => {});

  return hits;
}

export function renderRetrievedMemory(items = []) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const lines = items.map((item) => {
    const family = item.family ? ` family=${item.family}` : '';
    const reason = item.recallReason ? ` reason=${JSON.stringify(item.recallReason)}` : '';
    return [
      `- [${item.kind}]${family}${reason} summary=${JSON.stringify(String(item.summary || item.content || ''))}`,
      `  exact_text=${JSON.stringify(String(item.content || ''))}`
    ].join('\n');
  });
  return ['<retrieved_memory>', ...lines, '</retrieved_memory>'].join('\n');
}

export function renderToolExperience(items = []) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const lines = items.map((item) => `- [${item.family || item.kind}] ${item.summary || item.content}`);
  return ['<tool_experience>', ...lines, '</tool_experience>'].join('\n');
}
