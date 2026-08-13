import { randomUUID } from 'node:crypto';

import { getGlobalDatabase } from '../../src/core/sqlite-database.js';

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeTags(tags = []) {
  return [...new Set((Array.isArray(tags) ? tags : [])
    .map((tag) => String(tag || '').trim())
    .filter(Boolean))];
}

function normalizeSources(sources = []) {
  if (!Array.isArray(sources)) return [];
  return sources
    .map((source) => ({
      id: String(source?.id || `source_${randomUUID()}`),
      type: String(source?.type || 'manual'),
      name: String(source?.name || source?.url || 'Untitled source'),
      url: String(source?.url || ''),
      mime: String(source?.mime || 'text/plain'),
      contentText: String(source?.contentText || ''),
      sessionId: String(source?.sessionId || source?.sourceSessionId || ''),
      messageId: String(source?.messageId || source?.sourceMessageId || ''),
      selected: source?.selected !== false,
      status: String(source?.status || 'ready'),
      createdAt: String(source?.createdAt || nowIso()),
    }))
    .filter((source) => source.name || source.url || source.contentText);
}

function normalizeArtifacts(artifacts = {}) {
  if (!artifacts || typeof artifacts !== 'object' || Array.isArray(artifacts)) return {};
  return Object.fromEntries(
    Object.entries(artifacts)
      .filter(([kind, value]) => kind && value && typeof value === 'object')
      .map(([kind, value]) => [
        kind,
        {
          content: String(value.content || ''),
          updatedAt: String(value.updatedAt || ''),
        },
      ]),
  );
}

function legacySource(row) {
  const contentText = String(row.content_text || '');
  const sourceUrl = String(row.source_url || '');
  if (!contentText && !sourceUrl) return [];
  return normalizeSources([{
    id: `source_${row.id}`,
    type: row.source_type || 'manual',
    name: row.title || sourceUrl || 'Saved note',
    url: sourceUrl,
    contentText,
    status: row.fetch_status || 'ready',
    createdAt: row.created_at,
  }]);
}

function mapEntry(row) {
  if (!row) return null;
  const storedSources = normalizeSources(parseJson(row.sources_json, []));
  const sourceSessionId = row.source_session_id || '';
  const sourceMessageId = row.source_message_id || '';
  let sources = storedSources.length ? storedSources : legacySource(row);
  // ponytail: backfill legacy chat_answer sources that only stored ids on the entry
  if (sourceSessionId && sourceMessageId) {
    sources = sources.map((source) => {
      if (source.type !== 'chat_answer' || source.sessionId) return source;
      return { ...source, sessionId: sourceSessionId, messageId: sourceMessageId };
    });
  }
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    sourceSessionId,
    sourceMessageId,
    sourceQuestionText: row.source_question_text || '',
    title: row.title,
    contentText: row.content_text,
    summary: row.summary,
    tags: normalizeTags(parseJson(row.tags_json, [])),
    fetchStatus: row.fetch_status,
    sources,
    artifacts: normalizeArtifacts(parseJson(row.artifacts_json, {})),
  };
}

function mapJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    entryId: row.entry_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
    partialText: row.partial_text,
    resultSummary: row.result_summary,
    errorText: row.error_text,
  };
}

export function listScrapbookEntries({ query = '' } = {}) {
  const db = getGlobalDatabase();
  const trimmed = String(query || '').trim();
  const rows = trimmed
    ? db.prepare(`
        SELECT * FROM scrapbook_entries
        WHERE lower(title) LIKE '%' || lower(?) || '%'
           OR lower(content_text) LIKE '%' || lower(?) || '%'
           OR lower(summary) LIKE '%' || lower(?) || '%'
           OR lower(source_url) LIKE '%' || lower(?) || '%'
        ORDER BY updated_at DESC, created_at DESC
      `).all(trimmed, trimmed, trimmed, trimmed)
    : db.prepare(`
        SELECT * FROM scrapbook_entries
        ORDER BY updated_at DESC, created_at DESC
      `).all();
  return rows.map(mapEntry);
}

export function getScrapbookEntry(entryId) {
  return mapEntry(
    getGlobalDatabase().prepare('SELECT * FROM scrapbook_entries WHERE id = ?').get(entryId),
  );
}

export function createScrapbookEntry(payload = {}) {
  const db = getGlobalDatabase();
  const now = nowIso();
  const entry = {
    id: String(payload.id || `scrap_${randomUUID()}`),
    createdAt: String(payload.createdAt || now),
    updatedAt: String(payload.updatedAt || now),
    sourceType: String(payload.sourceType || 'manual'),
    sourceUrl: String(payload.sourceUrl || ''),
    sourceSessionId: String(payload.sourceSessionId || ''),
    sourceMessageId: String(payload.sourceMessageId || ''),
    sourceQuestionText: String(payload.sourceQuestionText || ''),
    title: String(payload.title || ''),
    contentText: String(payload.contentText || ''),
    summary: String(payload.summary || ''),
    tags: normalizeTags(payload.tags),
    fetchStatus: String(payload.fetchStatus || 'ready'),
    sources: normalizeSources(payload.sources),
    artifacts: normalizeArtifacts(payload.artifacts),
  };
  db.prepare(`
    INSERT INTO scrapbook_entries(
      id, created_at, updated_at, source_type, source_url, source_session_id, source_message_id,
      source_question_text, title, content_text, summary, tags_json, fetch_status,
      sources_json, artifacts_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.id,
    entry.createdAt,
    entry.updatedAt,
    entry.sourceType,
    entry.sourceUrl,
    entry.sourceSessionId,
    entry.sourceMessageId,
    entry.sourceQuestionText,
    entry.title,
    entry.contentText,
    entry.summary,
    JSON.stringify(entry.tags),
    entry.fetchStatus,
    JSON.stringify(entry.sources),
    JSON.stringify(entry.artifacts),
  );
  return entry;
}

export function updateScrapbookEntry(entryId, patch = {}) {
  const current = getScrapbookEntry(entryId);
  if (!current) return null;
  const next = {
    ...current,
    ...patch,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: String(patch.updatedAt || nowIso()),
    tags: normalizeTags(patch.tags ?? current.tags),
    sources: normalizeSources(patch.sources ?? current.sources),
    artifacts: normalizeArtifacts(patch.artifacts ?? current.artifacts),
  };
  getGlobalDatabase().prepare(`
    UPDATE scrapbook_entries
    SET updated_at = ?, source_type = ?, source_url = ?, source_session_id = ?, source_message_id = ?,
        source_question_text = ?, title = ?, content_text = ?, summary = ?, tags_json = ?, fetch_status = ?,
        sources_json = ?, artifacts_json = ?
    WHERE id = ?
  `).run(
    next.updatedAt,
    next.sourceType,
    next.sourceUrl,
    next.sourceSessionId,
    next.sourceMessageId,
    next.sourceQuestionText,
    next.title,
    next.contentText,
    next.summary,
    JSON.stringify(next.tags),
    next.fetchStatus,
    JSON.stringify(next.sources),
    JSON.stringify(next.artifacts),
    entryId,
  );
  return next;
}

export function deleteScrapbookEntry(entryId) {
  const result = getGlobalDatabase().prepare('DELETE FROM scrapbook_entries WHERE id = ?').run(entryId);
  return result.changes > 0;
}

export function listScrapbookSummaryJobs(entryId) {
  return getGlobalDatabase()
    .prepare(`
      SELECT * FROM scrapbook_summary_jobs
      WHERE entry_id = ?
      ORDER BY created_at DESC, rowid DESC
    `)
    .all(entryId)
    .map(mapJob);
}

export function getScrapbookSummaryJob(jobId) {
  return mapJob(
    getGlobalDatabase().prepare('SELECT * FROM scrapbook_summary_jobs WHERE id = ?').get(jobId),
  );
}

export function getLatestScrapbookSummaryJob(entryId) {
  return mapJob(
    getGlobalDatabase().prepare(`
      SELECT * FROM scrapbook_summary_jobs
      WHERE entry_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1
    `).get(entryId),
  );
}

export function createScrapbookSummaryJob(payload = {}) {
  const db = getGlobalDatabase();
  const now = nowIso();
  const job = {
    id: String(payload.id || `scrapjob_${randomUUID()}`),
    entryId: String(payload.entryId || ''),
    createdAt: String(payload.createdAt || now),
    updatedAt: String(payload.updatedAt || now),
    status: String(payload.status || 'pending'),
    partialText: String(payload.partialText || ''),
    resultSummary: String(payload.resultSummary || ''),
    errorText: String(payload.errorText || ''),
  };
  db.prepare(`
    INSERT INTO scrapbook_summary_jobs(
      id, entry_id, created_at, updated_at, status, partial_text, result_summary, error_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    job.id,
    job.entryId,
    job.createdAt,
    job.updatedAt,
    job.status,
    job.partialText,
    job.resultSummary,
    job.errorText,
  );
  return job;
}

export function updateScrapbookSummaryJob(jobId, patch = {}) {
  const current = getScrapbookSummaryJob(jobId);
  if (!current) return null;
  const next = {
    ...current,
    ...patch,
    id: current.id,
    entryId: current.entryId,
    createdAt: current.createdAt,
    updatedAt: String(patch.updatedAt || nowIso()),
  };
  getGlobalDatabase().prepare(`
    UPDATE scrapbook_summary_jobs
    SET updated_at = ?, status = ?, partial_text = ?, result_summary = ?, error_text = ?
    WHERE id = ?
  `).run(
    next.updatedAt,
    next.status,
    next.partialText,
    next.resultSummary,
    next.errorText,
    jobId,
  );
  return next;
}

export function completeScrapbookSummaryJob(jobId, patch = {}) {
  return updateScrapbookSummaryJob(jobId, {
    ...patch,
    status: String(patch.status || 'completed'),
  });
}
