import path from 'node:path';
import { sha256 } from './crypto-utils.js';
import {
  assertSafeMemoryContent,
  inferMemoryFamily,
  normalizeMemoryKind,
  normalizeMemoryScope,
  normalizeMemoryText
} from './memory-policy.js';
import {
  archiveMemoryQueueEntry,
  ensureMemoryQueueImported,
  findInboxByIdempotencyKey,
  listMemoryQueueEntries,
  removeInboxEntryFromSqlite,
  saveMemoryQueueEntry,
  updateInboxEntryInSqlite
} from './memory-queue-sqlite-store.js';
import {
  dbForScope,
  deleteMemory,
  ensurePersistentMemoryImported,
  getMaintenance,
  listMemoriesFromDb,
  normalizePersistentMemory,
  replaceScopeMemories,
  setMaintenance,
  syncMemoryFts,
  updateMemoryWithRevision
} from './memory-sqlite-store.js';
import { retrieveMemories } from './memory-retriever.js';
import { transaction } from './sqlite-database.js';

const ALLOWED_SCOPES = new Set(['user', 'global', 'project']);
const mutationLocks = new Map();

function withMutationLock(key, task) {
  const previous = mutationLocks.get(key) || Promise.resolve();
  const run = previous.catch(() => {}).then(task);
  mutationLocks.set(key, run);
  return run.finally(() => {
    if (mutationLocks.get(key) === run) mutationLocks.delete(key);
  });
}

function nowIso() {
  return new Date().toISOString();
}

function slugify(value) {
  const text = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return text || 'project';
}

export function getProjectMemoryKey(workspaceRoot = process.cwd(), projectAlias = '') {
  const alias = normalizeMemoryText(projectAlias);
  if (alias) return slugify(alias);
  const root = path.resolve(workspaceRoot || process.cwd());
  const base = path.basename(root);
  return `${slugify(base)}-${sha256(root).slice(0, 10)}`;
}

function ensureScope(scope) {
  const value = normalizeMemoryScope(scope, { fallback: '' });
  if (!ALLOWED_SCOPES.has(value)) {
    throw new Error(`Unsupported memory scope: ${scope}`);
  }
  return value;
}

function lockKeyForScope(scope, workspaceRoot = process.cwd()) {
  if (scope === 'project') return `memories:project:${path.resolve(workspaceRoot)}`;
  return `memories:global:${scope}`;
}

async function readScopeMemoryItems(scope, workspaceRoot = process.cwd(), projectAlias = '', filters = {}) {
  const normalizedScope = ensureScope(scope);
  await ensurePersistentMemoryImported({ workspaceRoot, scope: normalizedScope });
  const db = dbForScope(normalizedScope, workspaceRoot, { create: false });
  if (!db) return [];
  const projectKey = normalizedScope === 'project' ? getProjectMemoryKey(workspaceRoot, projectAlias) : '';
  return listMemoriesFromDb(db, { scope: normalizedScope, ...filters }).map((item) => (
    projectKey ? { ...item, projectKey } : item
  ));
}

function normalizeMemoryItem(item, scope, projectKey = '') {
  return normalizePersistentMemory(item, scope, projectKey);
}

function memoryBucketHash(items = []) {
  const stable = (Array.isArray(items) ? items : [])
    .map((item) => ({
      id: String(item?.id || ''),
      kind: String(item?.kind || ''),
      semanticKey: String(item?.semanticKey || ''),
      content: normalizeMemoryText(item?.content || ''),
      summary: normalizeMemoryText(item?.summary || ''),
      lifecycle: String(item?.lifecycle || ''),
      pinned: item?.pinned === true
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return sha256(JSON.stringify(stable));
}

function sameMemory(left, right) {
  const leftKey = normalizeMemoryText(left?.semanticKey);
  const rightKey = normalizeMemoryText(right?.semanticKey);
  if (leftKey && rightKey && leftKey === rightKey) return true;
  const a = normalizeMemoryText(left?.content);
  const b = normalizeMemoryText(right?.content);
  if (!a || !b) return false;
  return a === b;
}

function measureMemoryChars(item) {
  return normalizeMemoryText(item?.content).length + normalizeMemoryText(item?.summary).length;
}

function budgetForScope(scope, config = {}) {
  if (scope === 'user') return Math.max(80, Number(config?.memory?.max_user_chars || 1375));
  if (scope === 'global') return Math.max(80, Number(config?.memory?.max_global_chars || 2200));
  return Math.max(80, Number(config?.memory?.max_project_chars || 2200));
}

export async function listMemories({
  scope,
  workspaceRoot = process.cwd(),
  projectAlias = '',
  family,
  kind,
  lifecycle
}) {
  const normalizedScope = ensureScope(scope);
  return readScopeMemoryItems(normalizedScope, workspaceRoot, projectAlias, { family, kind, lifecycle });
}

/**
 * Optimistic update facade (design §48). Returns the refreshed memory or
 * null when expectedRevision no longer matches (stale write).
 */
export async function updateMemory({
  id,
  scope,
  patch = {},
  expectedRevision,
  workspaceRoot = process.cwd()
}) {
  const normalizedScope = ensureScope(scope);
  await ensurePersistentMemoryImported({ workspaceRoot, scope: normalizedScope });
  const db = dbForScope(normalizedScope, workspaceRoot);
  const changed = updateMemoryWithRevision(db, id, patch, expectedRevision);
  if (!changed) return null;
  const updated = listMemoriesFromDb(db, { scope: normalizedScope }).find((item) => item.id === id) || null;
  if (updated) {
    try { syncMemoryFts(db, updated); } catch { /* FTS is derived and rebuildable */ }
  }
  return updated;
}

export async function getMemoryBucketMaintenance({ scope, workspaceRoot = process.cwd(), projectAlias = '' }) {
  const normalizedScope = ensureScope(scope);
  await ensurePersistentMemoryImported({ workspaceRoot, scope: normalizedScope });
  const db = dbForScope(normalizedScope, workspaceRoot);
  const items = await readScopeMemoryItems(normalizedScope, workspaceRoot, projectAlias);
  const currentHash = memoryBucketHash(items);
  const stored = getMaintenance(db, normalizedScope) || {};
  const storedHash = String(stored.contentHash || '');
  const maintainedAt = String(stored.maintainedAt || '');
  return {
    scope: normalizedScope,
    itemCount: items.length,
    contentHash: currentHash,
    storedHash,
    maintainedAt,
    fresh: Boolean(maintainedAt && storedHash && storedHash === currentHash)
  };
}

async function markMemoryBucketMaintainedUnlocked({ scope, workspaceRoot = process.cwd(), projectAlias = '' }) {
  const normalizedScope = ensureScope(scope);
  await ensurePersistentMemoryImported({ workspaceRoot, scope: normalizedScope });
  const db = dbForScope(normalizedScope, workspaceRoot);
  const items = await readScopeMemoryItems(normalizedScope, workspaceRoot, projectAlias);
  const maintenance = {
    maintainedAt: nowIso(),
    contentHash: memoryBucketHash(items),
    itemCount: items.length
  };
  setMaintenance(db, normalizedScope, maintenance);
  return { scope: normalizedScope, ...maintenance };
}

export function markMemoryBucketMaintained(args = {}) {
  const normalizedScope = ensureScope(args.scope);
  return withMutationLock(lockKeyForScope(normalizedScope, args.workspaceRoot), () => (
    markMemoryBucketMaintainedUnlocked({ ...args, scope: normalizedScope })
  ));
}

async function replaceMemoryBucketUnlocked({
  scope,
  items = [],
  workspaceRoot = process.cwd(),
  projectAlias = '',
  markMaintained = false
} = {}) {
  const normalizedScope = ensureScope(scope);
  await ensurePersistentMemoryImported({ workspaceRoot, scope: normalizedScope });
  const db = dbForScope(normalizedScope, workspaceRoot);
  const projectKey = normalizedScope === 'project' ? getProjectMemoryKey(workspaceRoot, projectAlias) : '';
  const normalizedItems = (Array.isArray(items) ? items : [])
    .map((item) => normalizeMemoryItem(item, normalizedScope, projectKey))
    .filter((item) => item.content);
  const maintenance = markMaintained
    ? {
        maintainedAt: nowIso(),
        contentHash: memoryBucketHash(normalizedItems),
        itemCount: normalizedItems.length
      }
    : null;
  transaction(db, () => {
    replaceScopeMemories(db, normalizedScope, normalizedItems);
    if (maintenance) setMaintenance(db, normalizedScope, maintenance);
  });
  return {
    scope: normalizedScope,
    items: normalizedItems,
    maintenance
  };
}

export function replaceMemoryBucket(args = {}) {
  const normalizedScope = ensureScope(args.scope);
  return withMutationLock(lockKeyForScope(normalizedScope, args.workspaceRoot), () => (
    replaceMemoryBucketUnlocked({ ...args, scope: normalizedScope })
  ));
}

async function rememberMemoryUnlocked({
  scope,
  content,
  kind = 'note',
  summary = '',
  source = 'tool',
  confidence = 0.9,
  replaceSimilar = true,
  pinned = false,
  semanticKey = '',
  lifecycle = '',
  family = '',
  toolName = '',
  environmentKey = '',
  agentRole = '',
  tags = [],
  evidence = null,
  workspaceRoot = process.cwd(),
  projectAlias = '',
  config = {}
}) {
  const normalizedScope = ensureScope(scope);
  const normalizedContent = normalizeMemoryText(content);
  if (!normalizedContent) throw new Error('Memory content is required');
  assertSafeMemoryContent(normalizedContent);

  await ensurePersistentMemoryImported({ workspaceRoot, scope: normalizedScope });
  const db = dbForScope(normalizedScope, workspaceRoot);
  const projectKey = normalizedScope === 'project' ? getProjectMemoryKey(workspaceRoot, projectAlias) : '';
  const existing = await readScopeMemoryItems(normalizedScope, workspaceRoot, projectAlias);
  const probe = normalizeMemoryItem({
    content: normalizedContent,
    kind: normalizeMemoryKind(kind, 'note'),
    family,
    summary,
    source,
    confidence,
    pinned,
    semanticKey,
    toolName,
    environmentKey,
    agentRole,
    tags,
    evidence,
    ...(lifecycle ? { lifecycle: validateLifecycle(lifecycle) } : {})
  }, normalizedScope, projectKey);

  const replaceIndex = replaceSimilar ? existing.findIndex((item) => sameMemory(item, probe)) : -1;
  let saved;
  if (replaceIndex >= 0) {
    saved = {
      ...existing[replaceIndex],
      ...probe,
      id: existing[replaceIndex].id,
      createdAt: existing[replaceIndex].createdAt,
      hitCount: existing[replaceIndex].hitCount,
      hits: existing[replaceIndex].hits,
      accessCount: existing[replaceIndex].accessCount ?? existing[replaceIndex].hitCount,
      confirmationCount: existing[replaceIndex].confirmationCount || 0,
      lastConfirmedAt: existing[replaceIndex].lastConfirmedAt,
      revision: existing[replaceIndex].revision || 1,
      successCount: existing[replaceIndex].successCount,
      failureCount: existing[replaceIndex].failureCount,
      updatedAt: nowIso()
    };
    existing.splice(replaceIndex, 1, saved);
  } else {
    saved = probe;
    existing.unshift(saved);
  }

  const maxItems = Math.max(1, Number(config?.memory?.max_items_per_scope || 12));
  const maxChars = budgetForScope(normalizedScope, config);
  const deduped = [];
  const seen = new Set();
  for (const item of existing) {
    const key = item.semanticKey
      ? `semantic:${normalizeMemoryText(item.semanticKey)}`
      : `${item.kind}:${normalizeMemoryText(item.content)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  const ranked = deduped.map((item, index) => ({ item, index }));
  const pinnedRanked = ranked.filter((entry) => entry.item.pinned);
  const unpinnedRanked = ranked.filter((entry) => !entry.item.pinned);
  const capped = [...pinnedRanked, ...unpinnedRanked]
    .slice(0, maxItems)
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.item);

  let totalChars = capped.reduce((sum, item) => sum + measureMemoryChars(item), 0);
  while (capped.length > 1 && totalChars > maxChars) {
    let removeIdx = capped.length - 1;
    while (removeIdx >= 0 && capped[removeIdx].pinned) removeIdx -= 1;
    if (removeIdx < 0) break;
    const [removed] = capped.splice(removeIdx, 1);
    totalChars -= measureMemoryChars(removed);
  }
  transaction(db, () => replaceScopeMemories(db, normalizedScope, capped));
  if (!capped.some((item) => item.id === saved.id)) {
    const error = new Error('Memory was not saved because pinned items occupy the configured capacity');
    error.code = 'MEMORY_CAPACITY_PINNED';
    throw error;
  }
  return saved;
}

export function rememberMemory(args = {}) {
  const normalizedScope = ensureScope(args.scope);
  return withMutationLock(lockKeyForScope(normalizedScope, args.workspaceRoot), () => (
    rememberMemoryUnlocked({ ...args, scope: normalizedScope })
  ));
}

async function forgetMemoryUnlocked({ scope, id, workspaceRoot = process.cwd() }) {
  const normalizedScope = ensureScope(scope);
  await ensurePersistentMemoryImported({ workspaceRoot, scope: normalizedScope });
  const db = dbForScope(normalizedScope, workspaceRoot);
  const removed = deleteMemory(db, id);
  return { removed };
}

export async function searchMemories({
  scope = 'all',
  query = '',
  family,
  kind,
  limit,
  workspaceRoot = process.cwd(),
  config = {}
} = {}) {
  const needle = normalizeMemoryText(query);
  const requestedScope = String(scope || 'all').trim().toLowerCase();
  if (!needle) {
    if (requestedScope === 'all') {
      const [user, globalItems, project] = await Promise.all([
        listMemories({ scope: 'user', workspaceRoot }),
        listMemories({ scope: 'global', workspaceRoot }),
        listMemories({ scope: 'project', workspaceRoot })
      ]);
      return [...user, ...globalItems, ...project];
    }
    return listMemories({ scope: requestedScope, workspaceRoot });
  }
  return retrieveMemories({
    query: needle,
    scope: requestedScope,
    family,
    kind,
    limit,
    workspaceRoot,
    config,
    mode: 'turn'
  });
}

// ---------------------------------------------------------------------------
// Dream Loop: inbox capture, lifecycle, archive, promotion
// ---------------------------------------------------------------------------

const VALID_LIFECYCLE = new Set(['observed', 'operational', 'longterm', 'archived']);

function validateLifecycle(value) {
  const lc = String(value || '').trim().toLowerCase();
  // Legacy alias from older dream docs — treat as observed staging.
  if (lc === 'candidate') return 'observed';
  if (!VALID_LIFECYCLE.has(lc)) throw new Error(`Invalid lifecycle state: ${value}`);
  return lc;
}

function normalizeInboxScope(value) {
  // Accept legacy repo/thread aliases; persist only user|global|project.
  const raw = String(value || 'project').trim().toLowerCase();
  if (raw && !['user', 'global', 'project', 'repo', 'thread'].includes(raw)) {
    throw new Error(`Unsupported inbox scope: ${value}`);
  }
  return normalizeMemoryScope(raw || 'project', { fallback: 'project' });
}

async function captureToInboxUnlocked({
  scope = 'global',
  type = 'observation',
  family = '',
  summary,
  details = '',
  suggestedAction = '',
  tags = [],
  source = 'tool',
  semanticKey = '',
  idempotencyKey = '',
  evidence = null,
  projectDir = ''
} = {}) {
  const normalizedSummary = normalizeMemoryText(summary);
  if (!normalizedSummary) throw new Error('Inbox capture summary is required');
  assertSafeMemoryContent(normalizedSummary);
  const normalizedDetails = normalizeMemoryText(details);
  const normalizedSuggestedAction = normalizeMemoryText(suggestedAction);
  if (normalizedDetails) assertSafeMemoryContent(normalizedDetails);
  if (normalizedSuggestedAction) assertSafeMemoryContent(normalizedSuggestedAction);

  await ensureMemoryQueueImported();
  const now = nowIso();
  const id = `inbox_${sha256(`${normalizedSummary}:${now}:${Math.random()}`).slice(0, 12)}`;
  const normalizedSemanticKey = normalizeMemoryText(semanticKey).slice(0, 160);
  const normalizedIdempotencyKey = normalizeMemoryText(idempotencyKey).slice(0, 320);
  const entry = {
    id,
    timestamp: now,
    scope: normalizeInboxScope(scope),
    source,
    type: normalizeMemoryKind(type, 'note'),
    family: inferMemoryFamily({
      family,
      scope: normalizeInboxScope(scope),
      kind: normalizeMemoryKind(type, 'note'),
      content: normalizedDetails,
      summary: normalizedSummary
    }),
    summary: normalizedSummary,
    details: normalizedDetails,
    suggestedAction: normalizedSuggestedAction,
    tags: Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter(Boolean) : [],
    lifecycle: 'observed',
    ...(normalizeMemoryText(projectDir) ? { projectDir: String(projectDir).trim() } : {}),
    ...(normalizedSemanticKey ? { semanticKey: normalizedSemanticKey } : {}),
    ...(normalizedIdempotencyKey ? { idempotencyKey: normalizedIdempotencyKey } : {}),
    ...(evidence && typeof evidence === 'object' && !Array.isArray(evidence)
      ? {
          evidence: {
            sessionId: String(evidence.sessionId || '').slice(0, 120),
            reviewerVersion: Number(evidence.reviewerVersion || 0),
            contentHash: String(evidence.contentHash || '').slice(0, 128),
            evidenceRoles: Array.isArray(evidence.evidenceRoles)
              ? evidence.evidenceRoles.map((role) => String(role).slice(0, 24)).slice(0, 8)
              : [],
            evidenceMessageIndices: Array.isArray(evidence.evidenceMessageIndices)
              ? evidence.evidenceMessageIndices
                  .map((index) => Number(index))
                  .filter((index) => Number.isInteger(index) && index >= 0)
                  .slice(0, 16)
              : [],
            decisionState: String(evidence.decisionState || '').slice(0, 40),
            durableScore: Math.max(0, Math.min(10, Number(evidence.durableScore) || 0)),
            confidence: Math.max(0, Math.min(1, Number(evidence.confidence) || 0)),
            reason: normalizeMemoryText(evidence.reason).slice(0, 240),
            ...(evidence.successful_recovery === true ? { successful_recovery: true } : {}),
            ...(evidence.verified === true ? { verified: true } : {}),
            ...(evidence.verification && typeof evidence.verification === 'object'
              ? { verification: { type: String(evidence.verification.type || '').slice(0, 40) } }
              : {}),
            ...(Number.isFinite(Number(evidence.failed_attempts))
              ? { failed_attempts: Number(evidence.failed_attempts) }
              : {}),
            ...(evidence.failed_approach
              ? { failed_approach: String(evidence.failed_approach).slice(0, 240) }
              : {}),
            ...(evidence.working_approach
              ? { working_approach: String(evidence.working_approach).slice(0, 240) }
              : {}),
            ...(Array.isArray(evidence.tool_names)
              ? { tool_names: evidence.tool_names.map((name) => String(name).slice(0, 40)).filter(Boolean).slice(0, 8) }
              : {}),
            ...(Array.isArray(evidence.sourceBranchIds)
              ? { sourceBranchIds: [...new Set(evidence.sourceBranchIds.map((id) => String(id).slice(0, 120)).filter(Boolean))].slice(0, 16) }
              : {}),
            ...(Array.isArray(evidence.agentRoles)
              ? { agentRoles: [...new Set(evidence.agentRoles.map((role) => String(role).slice(0, 40)).filter(Boolean))].slice(0, 16) }
              : {}),
            ...(Number.isFinite(Number(evidence.branchCandidateCount))
              ? { branchCandidateCount: Math.max(0, Number(evidence.branchCandidateCount)) }
              : {})
          }
        }
      : {})
  };

  if (normalizedIdempotencyKey) {
    const existing = findInboxByIdempotencyKey(normalizedIdempotencyKey);
    if (existing) return { ...existing, duplicate: true };
  }
  return saveMemoryQueueEntry('inbox', entry);
}

export function forgetMemory(args = {}) {
  const normalizedScope = ensureScope(args.scope);
  return withMutationLock(lockKeyForScope(normalizedScope, args.workspaceRoot), () => (
    forgetMemoryUnlocked({ ...args, scope: normalizedScope })
  ));
}

export function captureToInbox(args = {}) {
  return withMutationLock('inbox', () => captureToInboxUnlocked(args));
}

export async function commitForkMemoryCandidates({
  candidates = [],
  sessionId = '',
  workspaceRoot = process.cwd()
} = {}) {
  const grouped = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const summary = normalizeMemoryText(candidate?.summary || candidate?.content);
    if (!summary) continue;
    const scope = normalizeInboxScope(candidate.scope);
    const kind = normalizeMemoryKind(candidate.kind, 'note');
    const family = inferMemoryFamily({
      family: candidate.family,
      scope,
      kind,
      content: candidate.content,
      summary
    });
    const key = [scope, family, kind, normalizeMemoryText(candidate.semanticKey) || summary.toLowerCase()].join(':');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({ ...candidate, scope, kind, family, summary });
  }
  const entries = [];
  for (const [key, group] of grouped) {
    const first = group[0];
    const sourceBranchIds = [...new Set(group.map((item) => String(item.sourceBranchId || '')).filter(Boolean))];
    const agentRoles = [...new Set(group.map((item) => String(item.agentRole || '')).filter(Boolean))];
    entries.push(await captureToInbox({
      scope: first.scope,
      type: first.kind,
      family: first.family,
      summary: first.summary,
      details: group.map((item) => String(item.content || '')).sort((a, b) => b.length - a.length)[0],
      source: 'fork-parent-join',
      semanticKey: first.semanticKey || '',
      idempotencyKey: `fork-join:${sessionId}:${sha256(key).slice(0, 24)}`,
      evidence: {
        sessionId,
        sourceBranchIds,
        agentRoles,
        branchCandidateCount: group.length
      },
      projectDir: workspaceRoot
    }));
  }
  return { joined: entries.length, entries };
}

export async function listInbox({ since, scope } = {}) {
  await ensureMemoryQueueImported();
  const normalizedScope = scope ? normalizeMemoryScope(scope, { fallback: 'project' }) : '';
  return listMemoryQueueEntries('inbox', { since, scope: normalizedScope }).map((entry) => ({
    ...entry,
    scope: normalizeMemoryScope(entry?.scope, { fallback: 'project' })
  }));
}

async function updateInboxEntryUnlocked(id, updates = {}) {
  await ensureMemoryQueueImported();
  const normalized = { ...updates };
  if (normalized.lifecycle) normalized.lifecycle = validateLifecycle(normalized.lifecycle);
  return updateInboxEntryInSqlite(id, normalized);
}

export function updateInboxEntry(id, updates = {}) {
  return withMutationLock('inbox', () => updateInboxEntryUnlocked(id, updates));
}

async function removeInboxEntryUnlocked(id) {
  await ensureMemoryQueueImported();
  return removeInboxEntryFromSqlite(id);
}

export function removeInboxEntry(id) {
  return withMutationLock('inbox', () => removeInboxEntryUnlocked(id));
}

async function archiveEntryUnlocked(entry, reason = '', auditNote = '') {
  await ensureMemoryQueueImported();
  const archived = {
    ...entry,
    lifecycle: 'archived',
    archivedAt: nowIso(),
    archiveReason: normalizeMemoryText(reason),
    auditNote: normalizeMemoryText(auditNote)
  };
  return archiveMemoryQueueEntry(entry, archived);
}

export function archiveEntry(entry, reason = '', auditNote = '') {
  return withMutationLock('inbox', () => archiveEntryUnlocked(entry, reason, auditNote));
}

export async function listArchive({ since, scope } = {}) {
  await ensureMemoryQueueImported();
  const normalizedScope = scope ? normalizeMemoryScope(scope, { fallback: 'project' }) : '';
  return listMemoryQueueEntries('archive', { since, scope: normalizedScope });
}

export async function promoteMemory({
  entry,
  scope = 'global',
  lifecycle = 'operational',
  workspaceRoot = process.cwd(),
  projectAlias = '',
  config = {},
  confidence = 0.9
} = {}) {
  if (!entry?.summary) throw new Error('Entry with summary is required for promotion');
  const lc = validateLifecycle(lifecycle);
  const content = normalizeMemoryText(entry.details || entry.summary);
  const saved = await rememberMemory({
    scope: normalizeMemoryScope(scope, { fallback: 'global' }),
    content,
    kind: normalizeMemoryKind(entry.type || entry.kind, 'note'),
    family: entry.family || '',
    semanticKey: entry.semanticKey || '',
    summary: normalizeMemoryText(entry.summary),
    toolName: entry.toolName || '',
    evidence: entry.evidence,
    source: `dream-promote:${entry.id}`,
    confidence: Math.min(1, Math.max(0.5, confidence)),
    lifecycle: lc,
    replaceSimilar: true,
    workspaceRoot,
    projectAlias,
    config
  });
  // Remove from inbox
  await removeInboxEntry(entry.id);
  return { promoted: saved, lifecycle: lc };
}
