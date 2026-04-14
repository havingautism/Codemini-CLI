import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from './crypto-utils.js';
import { getMemoryDir, getProjectMemoryDir, getInboxDir, getArchiveDir } from './paths.js';
import { assertSafeMemoryContent, normalizeMemoryText, summarizeMemoryContent } from './memory-policy.js';

const ALLOWED_SCOPES = new Set(['user', 'global', 'project']);

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
  const value = String(scope || '').trim().toLowerCase();
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
  return path.join(getProjectMemoryDir(workspaceRoot), `${getProjectMemoryKey(workspaceRoot, projectAlias)}.json`);
}

async function readMemoryBucket(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

async function writeMemoryBucket(filePath, items) {
  await ensureParent(filePath);
  await fs.writeFile(filePath, `${JSON.stringify({ items }, null, 2)}\n`, 'utf8');
}

function normalizeMemoryItem(item, scope, projectKey = '') {
  const now = nowIso();
  const content = normalizeMemoryText(item?.content || '');
  return {
    id: String(item?.id || `mem_${sha256(`${scope}:${projectKey}:${content}:${now}:${Math.random()}`).slice(0, 12)}`),
    scope,
    projectKey: projectKey || undefined,
    kind: String(item?.kind || 'note').trim() || 'note',
    content,
    summary: normalizeMemoryText(item?.summary || summarizeMemoryContent(content)),
    source: String(item?.source || 'tool').trim() || 'tool',
    confidence: Number.isFinite(Number(item?.confidence)) ? Number(item.confidence) : 0.9,
    createdAt: String(item?.createdAt || now),
    updatedAt: String(item?.updatedAt || now),
    hits: Number.isFinite(Number(item?.hits)) ? Number(item.hits) : 0,
    pinned: item?.pinned === true
  };
}

function sameMemory(left, right) {
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
  const filePath = buildFilePath(normalizedScope, workspaceRoot, projectAlias);
  const projectKey = normalizedScope === 'project' ? getProjectMemoryKey(workspaceRoot, projectAlias) : '';
  const items = await readMemoryBucket(filePath);
  return items
    .map((item) => normalizeMemoryItem(item, normalizedScope, projectKey))
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

export async function rememberMemory({
  scope,
  content,
  kind = 'note',
  summary = '',
  source = 'tool',
  confidence = 0.9,
  replaceSimilar = true,
  pinned = false,
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
  const existing = (await readMemoryBucket(filePath)).map((item) => normalizeMemoryItem(item, normalizedScope, projectKey));
  const probe = normalizeMemoryItem({ content: normalizedContent, kind, summary, source, confidence, pinned }, normalizedScope, projectKey);

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
    const key = `${item.kind}:${normalizeMemoryText(item.content)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
    if (deduped.length >= maxItems) break;
  }
  let totalChars = deduped.reduce((sum, item) => sum + measureMemoryChars(item), 0);
  while (deduped.length > 1 && totalChars > maxChars) {
    const removed = deduped.pop();
    totalChars -= measureMemoryChars(removed);
  }
  await writeMemoryBucket(filePath, deduped);
  return saved;
}

export async function forgetMemory({ scope, id, workspaceRoot = process.cwd(), projectAlias = '' }) {
  const normalizedScope = ensureScope(scope);
  const filePath = buildFilePath(normalizedScope, workspaceRoot, projectAlias);
  const existing = await listMemories({ scope: normalizedScope, workspaceRoot, projectAlias });
  const kept = existing.filter((item) => item.id !== id);
  await writeMemoryBucket(filePath, kept);
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

const VALID_LIFECYCLE = new Set(['observed', 'candidate', 'operational', 'longterm', 'archived']);
const VALID_INBOX_SCOPES = new Set(['global', 'repo', 'thread', 'project', 'user']);

function validateLifecycle(value) {
  const lc = String(value || '').trim().toLowerCase();
  if (!VALID_LIFECYCLE.has(lc)) throw new Error(`Invalid lifecycle state: ${value}`);
  return lc;
}

function normalizeInboxScope(value) {
  const scope = String(value || 'global').trim().toLowerCase();
  if (!VALID_INBOX_SCOPES.has(scope)) throw new Error(`Unsupported inbox scope: ${value}`);
  return scope;
}

function todayDir(baseDir) {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(baseDir, date);
}

async function readJsonArray(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeJsonArray(filePath, items) {
  await ensureParent(filePath);
  await fs.writeFile(filePath, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
}

export async function captureToInbox({
  scope = 'global',
  type = 'observation',
  summary,
  details = '',
  suggestedAction = '',
  tags = [],
  source = 'tool'
} = {}) {
  const normalizedSummary = normalizeMemoryText(summary);
  if (!normalizedSummary) throw new Error('Inbox capture summary is required');
  assertSafeMemoryContent(normalizedSummary);

  const dir = todayDir(getInboxDir());
  await fs.mkdir(dir, { recursive: true });
  const now = nowIso();
  const id = `inbox_${sha256(`${normalizedSummary}:${now}:${Math.random()}`).slice(0, 12)}`;
  const entry = {
    id,
    timestamp: now,
    scope: normalizeInboxScope(scope),
    source,
    type: String(type || 'observation').trim().toLowerCase(),
    summary: normalizedSummary,
    details: normalizeMemoryText(details),
    suggestedAction: normalizeMemoryText(suggestedAction),
    tags: Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter(Boolean) : [],
    lifecycle: 'observed'
  };

  const indexPath = path.join(dir, 'index.json');
  const entries = await readJsonArray(indexPath);
  entries.push(entry);
  await writeJsonArray(indexPath, entries);
  return entry;
}

export async function listInbox({ since, scope } = {}) {
  const inboxBase = getInboxDir();
  let dayDirs;
  try {
    const entries = await fs.readdir(inboxBase);
    dayDirs = entries.filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e)).sort();
  } catch {
    return [];
  }
  if (since) {
    const sinceStr = String(since).slice(0, 10);
    dayDirs = dayDirs.filter((d) => d >= sinceStr);
  }
  const all = [];
  for (const day of dayDirs) {
    const indexPath = path.join(inboxBase, day, 'index.json');
    const entries = await readJsonArray(indexPath);
    all.push(...entries);
  }
  if (scope) {
    const sc = String(scope).trim().toLowerCase();
    return all.filter((e) => e.scope === sc);
  }
  return all;
}

export async function updateInboxEntry(id, updates = {}) {
  const inboxBase = getInboxDir();
  let dayDirs;
  try {
    dayDirs = (await fs.readdir(inboxBase)).filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e)).sort();
  } catch {
    return null;
  }
  for (const day of dayDirs) {
    const indexPath = path.join(inboxBase, day, 'index.json');
    const entries = await readJsonArray(indexPath);
    const idx = entries.findIndex((e) => e.id === id);
    if (idx === -1) continue;
    if (updates.lifecycle) updates.lifecycle = validateLifecycle(updates.lifecycle);
    entries[idx] = { ...entries[idx], ...updates };
    await writeJsonArray(indexPath, entries);
    return entries[idx];
  }
  return null;
}

export async function removeInboxEntry(id) {
  const inboxBase = getInboxDir();
  let dayDirs;
  try {
    dayDirs = (await fs.readdir(inboxBase)).filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e)).sort();
  } catch {
    return false;
  }
  for (const day of dayDirs) {
    const indexPath = path.join(inboxBase, day, 'index.json');
    const entries = await readJsonArray(indexPath);
    const idx = entries.findIndex((e) => e.id === id);
    if (idx === -1) continue;
    entries.splice(idx, 1);
    await writeJsonArray(indexPath, entries);
    return true;
  }
  return false;
}

export async function archiveEntry(entry, reason = '', auditNote = '') {
  const archiveDir = getArchiveDir();
  const date = new Date().toISOString().slice(0, 10);
  const dir = path.join(archiveDir, date);
  await fs.mkdir(dir, { recursive: true });
  const archived = {
    ...entry,
    lifecycle: 'archived',
    archivedAt: nowIso(),
    archiveReason: normalizeMemoryText(reason),
    auditNote: normalizeMemoryText(auditNote)
  };
  const indexPath = path.join(dir, 'index.json');
  const entries = await readJsonArray(indexPath);
  entries.push(archived);
  await writeJsonArray(indexPath, entries);
  await removeInboxEntry(entry.id);
  return archived;
}

export async function listArchive({ since, scope } = {}) {
  const archiveBase = getArchiveDir();
  let dayDirs;
  try {
    const entries = await fs.readdir(archiveBase);
    dayDirs = entries.filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e)).sort();
  } catch {
    return [];
  }
  if (since) {
    const sinceStr = String(since).slice(0, 10);
    dayDirs = dayDirs.filter((d) => d >= sinceStr);
  }
  const all = [];
  for (const day of dayDirs) {
    const indexPath = path.join(archiveBase, day, 'index.json');
    const entries = await readJsonArray(indexPath);
    all.push(...entries);
  }
  if (scope) {
    const sc = String(scope).trim().toLowerCase();
    return all.filter((e) => e.scope === sc);
  }
  return all;
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
    scope,
    content,
    kind: entry.type || 'note',
    summary: normalizeMemoryText(entry.summary),
    source: `dream-promote:${entry.id}`,
    confidence: Math.min(1, Math.max(0.5, confidence)),
    replaceSimilar: true,
    workspaceRoot,
    projectAlias,
    config
  });
  // Tag the saved item with lifecycle
  const filePath = buildFilePath(scope, workspaceRoot, projectAlias);
  const projectKey = scope === 'project' ? getProjectMemoryKey(workspaceRoot, projectAlias) : '';
  const items = (await readMemoryBucket(filePath)).map((item) => normalizeMemoryItem(item, scope, projectKey));
  const target = items.find((item) => item.id === saved.id);
  if (target) {
    target.lifecycle = lc;
    await writeMemoryBucket(filePath, items);
  }
  // Remove from inbox
  await removeInboxEntry(entry.id);
  return { promoted: saved, lifecycle: lc };
}
