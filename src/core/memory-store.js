import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from './crypto-utils.js';
import { getMemoryDir, getProjectMemoryDir } from './paths.js';
import {
  assertSafeMemoryContent,
  normalizeMemoryKind,
  normalizeMemoryScope,
  normalizeMemoryText,
  summarizeMemoryContent
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

async function ensureParent(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function buildFilePath(scope, workspaceRoot = process.cwd(), projectAlias = '') {
  if (scope === 'user') return path.join(getMemoryDir(), 'user.json');
  if (scope === 'global') return path.join(getMemoryDir(), 'global.json');
  return path.join(getProjectMemoryDir(workspaceRoot), 'project.json');
}

async function listProjectMemoryFiles(workspaceRoot = process.cwd()) {
  const dir = getProjectMemoryDir(workspaceRoot);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => path.join(dir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

async function readMemoryBucket(filePath) {
  const doc = await readMemoryBucketDocument(filePath);
  return doc.items;
}

async function readMemoryBucketDocument(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      items: Array.isArray(parsed?.items) ? parsed.items : [],
      maintenance: parsed?.maintenance && typeof parsed.maintenance === 'object' ? parsed.maintenance : null
    };
  } catch {
    return { items: [], maintenance: null };
  }
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

async function writeMemoryBucket(filePath, items, { maintenance = null } = {}) {
  await ensureParent(filePath);
  const doc = { items };
  if (maintenance) doc.maintenance = maintenance;
  await fs.writeFile(filePath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
}

function dedupeMemoryItems(items = []) {
  const deduped = [];
  const seen = new Set();
  for (const item of items) {
    const key = item.id ? `id:${item.id}` : `${item.kind}:${normalizeMemoryText(item.content)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

async function readProjectMemoryItems(workspaceRoot = process.cwd(), projectAlias = '') {
  const projectKey = getProjectMemoryKey(workspaceRoot, projectAlias);
  const files = await listProjectMemoryFiles(workspaceRoot);
  const items = [];
  for (const file of files) {
    const bucket = await readMemoryBucket(file);
    items.push(...bucket.map((item) => normalizeMemoryItem(item, 'project', projectKey)));
  }
  return dedupeMemoryItems(items)
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

async function readScopeMemoryItems(scope, workspaceRoot = process.cwd(), projectAlias = '') {
  const normalizedScope = ensureScope(scope);
  if (normalizedScope === 'project') return readProjectMemoryItems(workspaceRoot, projectAlias);
  const filePath = buildFilePath(normalizedScope, workspaceRoot, projectAlias);
  return (await readMemoryBucket(filePath))
    .map((item) => normalizeMemoryItem(item, normalizedScope, ''))
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

function normalizeMemoryItem(item, scope, projectKey = '') {
  const now = nowIso();
  const content = normalizeMemoryText(item?.content || '');
  return {
    id: String(item?.id || `mem_${sha256(`${scope}:${projectKey}:${content}:${now}:${Math.random()}`).slice(0, 12)}`),
    scope,
    projectKey: projectKey || undefined,
    kind: normalizeMemoryKind(item?.kind, 'note'),
    ...(normalizeMemoryText(item?.semanticKey) ? { semanticKey: normalizeMemoryText(item.semanticKey).slice(0, 160) } : {}),
    content,
    summary: normalizeMemoryText(item?.summary || summarizeMemoryContent(content)),
    source: String(item?.source || 'tool').trim() || 'tool',
    confidence: Number.isFinite(Number(item?.confidence)) ? Number(item.confidence) : 0.9,
    createdAt: String(item?.createdAt || now),
    updatedAt: String(item?.updatedAt || now),
    hits: Number.isFinite(Number(item?.hits)) ? Number(item.hits) : 0,
    pinned: item?.pinned === true,
    ...(item?.lifecycle ? { lifecycle: String(item.lifecycle) } : {})
  };
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

export async function listMemories({ scope, workspaceRoot = process.cwd(), projectAlias = '' }) {
  const normalizedScope = ensureScope(scope);
  return readScopeMemoryItems(normalizedScope, workspaceRoot, projectAlias);
}

export async function getMemoryBucketMaintenance({ scope, workspaceRoot = process.cwd(), projectAlias = '' }) {
  const normalizedScope = ensureScope(scope);
  const filePath = buildFilePath(normalizedScope, workspaceRoot, projectAlias);
  const doc = await readMemoryBucketDocument(filePath);
  const items = normalizedScope === 'project'
    ? await readProjectMemoryItems(workspaceRoot, projectAlias)
    : doc.items.map((item) => normalizeMemoryItem(item, normalizedScope, ''));
  const currentHash = memoryBucketHash(items);
  const storedHash = String(doc.maintenance?.contentHash || '');
  const maintainedAt = String(doc.maintenance?.maintainedAt || '');
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
  const filePath = buildFilePath(normalizedScope, workspaceRoot, projectAlias);
  const items = await readScopeMemoryItems(normalizedScope, workspaceRoot, projectAlias);
  const maintenance = {
    maintainedAt: nowIso(),
    contentHash: memoryBucketHash(items),
    itemCount: items.length
  };
  await writeMemoryBucket(filePath, items, { maintenance });
  return { scope: normalizedScope, ...maintenance };
}

export function markMemoryBucketMaintained(args = {}) {
  const normalizedScope = ensureScope(args.scope);
  const filePath = buildFilePath(normalizedScope, args.workspaceRoot, args.projectAlias);
  return withMutationLock(`bucket:${filePath}`, () => markMemoryBucketMaintainedUnlocked({ ...args, scope: normalizedScope }));
}

async function replaceMemoryBucketUnlocked({
  scope,
  items = [],
  workspaceRoot = process.cwd(),
  projectAlias = '',
  markMaintained = false
} = {}) {
  const normalizedScope = ensureScope(scope);
  const filePath = buildFilePath(normalizedScope, workspaceRoot, projectAlias);
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
  await writeMemoryBucket(filePath, normalizedItems, { maintenance });
  return {
    scope: normalizedScope,
    items: normalizedItems,
    maintenance
  };
}

export function replaceMemoryBucket(args = {}) {
  const normalizedScope = ensureScope(args.scope);
  const filePath = buildFilePath(normalizedScope, args.workspaceRoot, args.projectAlias);
  return withMutationLock(`bucket:${filePath}`, () => replaceMemoryBucketUnlocked({ ...args, scope: normalizedScope }));
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
  workspaceRoot = process.cwd(),
  projectAlias = '',
  config = {}
}) {
  const normalizedScope = ensureScope(scope);
  const normalizedContent = normalizeMemoryText(content);
  if (!normalizedContent) throw new Error('Memory content is required');
  assertSafeMemoryContent(normalizedContent);

  const filePath = buildFilePath(normalizedScope, workspaceRoot, projectAlias);
  const projectKey = normalizedScope === 'project' ? getProjectMemoryKey(workspaceRoot, projectAlias) : '';
  const existing = await readScopeMemoryItems(normalizedScope, workspaceRoot, projectAlias);
  const probe = normalizeMemoryItem({
    content: normalizedContent,
    kind: normalizeMemoryKind(kind, 'note'),
    summary,
    source,
    confidence,
    pinned,
    semanticKey,
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
  // Prefer pinned items when capping; preserve relative order among survivors.
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
  await writeMemoryBucket(filePath, capped);
  if (!capped.some((item) => item.id === saved.id)) {
    const error = new Error('Memory was not saved because pinned items occupy the configured capacity');
    error.code = 'MEMORY_CAPACITY_PINNED';
    throw error;
  }
  return saved;
}

export function rememberMemory(args = {}) {
  const normalizedScope = ensureScope(args.scope);
  const filePath = buildFilePath(normalizedScope, args.workspaceRoot, args.projectAlias);
  return withMutationLock(`bucket:${filePath}`, () => rememberMemoryUnlocked({ ...args, scope: normalizedScope }));
}

async function forgetMemoryUnlocked({ scope, id, workspaceRoot = process.cwd(), projectAlias = '' }) {
  const normalizedScope = ensureScope(scope);
  const filePath = buildFilePath(normalizedScope, workspaceRoot, projectAlias);
  const existing = await listMemories({ scope: normalizedScope, workspaceRoot, projectAlias });
  const kept = existing.filter((item) => item.id !== id);
  await writeMemoryBucket(filePath, kept);
  if (normalizedScope === 'project') {
    const files = (await listProjectMemoryFiles(workspaceRoot)).filter((file) => file !== filePath);
    await Promise.all(files.map(async (file) => {
      const bucket = await readMemoryBucket(file);
      const next = bucket.filter((item) => String(item?.id || '') !== id);
      if (next.length !== bucket.length) await writeMemoryBucket(file, next);
    }));
  }
  return { removed: existing.length - kept.length };
}

export async function searchMemories({ scope, query, workspaceRoot = process.cwd(), projectAlias = '' }) {
  const items = await listMemories({ scope, workspaceRoot, projectAlias });
  const needle = normalizeMemoryText(query).toLowerCase();
  if (!needle) return items;
  return items.filter((item) => item.content.toLowerCase().includes(needle) || item.summary.toLowerCase().includes(needle));
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
            reason: normalizeMemoryText(evidence.reason).slice(0, 240)
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
  const filePath = buildFilePath(normalizedScope, args.workspaceRoot, args.projectAlias);
  return withMutationLock(`bucket:${filePath}`, () => forgetMemoryUnlocked({ ...args, scope: normalizedScope }));
}

export function captureToInbox(args = {}) {
  return withMutationLock('inbox', () => captureToInboxUnlocked(args));
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
    semanticKey: entry.semanticKey || '',
    summary: normalizeMemoryText(entry.summary),
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
