import { randomUUID } from 'node:crypto';
import { getGlobalDatabase } from './sqlite-database.js';
import { normalizeModelUsage } from './model-usage.js';

// No session foreign key: deleting or compacting a transcript must not erase usage.
export function recordTokenUsage({ id = randomUUID(), createdAt = new Date().toISOString(), model = '', provider = '', sessionId = '', usage, timing } = {}) {
  const normalized = normalizeModelUsage(usage);
  const timestamp = new Date(createdAt).toISOString();
  const times = timing || usage?.timing;
  const sent = Date.parse(times?.requestSentAt);
  const first = Date.parse(times?.firstTokenAt);
  const done = Date.parse(times?.completedAt);
  const duration = Number.isFinite(sent) && Number.isFinite(done) && done >= sent ? done - sent : null;
  const split = duration != null && Number.isFinite(first) && first >= sent && first <= done;
  getGlobalDatabase().prepare(`
    INSERT OR IGNORE INTO token_usage_records
      (id, created_at, model, provider, input_tokens, output_tokens, total_tokens,
       cached_input_tokens, cache_write_input_tokens, reported, session_id,
       cache_reported, reasoning_output_tokens, duration_ms, waiting_ms, generating_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, timestamp, String(model), String(provider), normalized?.inputTokens || 0,
    normalized?.outputTokens || 0, normalized?.totalTokens || 0,
    normalized?.cachedInputTokens || 0, normalized?.cacheWriteInputTokens || 0, normalized ? 1 : 0,
    String(sessionId || ''), normalized ? Number(normalized.cacheUsageStatus === 'reported') : null,
    normalized?.reasoningOutputTokens ?? null, duration, split ? first - sent : null, split ? done - first : null);
}

function legacyAbortUsageParent(db, sessionId, createdAt) {
  // Before usageParent existed, abort continuations copied UI rows verbatim.
  // Require identical IDs, ordinals and payloads for the entire source prefix,
  // ending at a stopped assistant. Text/title similarity is not lineage.
  return db.prepare(`SELECT source.id AS sessionId, ? AS through
    FROM ui_messages tail
    JOIN sessions source ON source.id = tail.session_id
    JOIN ui_messages copy ON copy.session_id = ? AND copy.ordinal = tail.ordinal
      AND copy.message_id = tail.message_id AND copy.payload_json = tail.payload_json
    WHERE source.created_at < ? AND source.project_dir = (
      SELECT project_dir FROM sessions WHERE id = ?
    ) AND tail.role NOT IN ('you', 'system', 'divider') AND tail.message_id <> ''
      AND json_extract(tail.payload_json, '$.manualAborted') = 1
      AND tail.ordinal = (SELECT MAX(ordinal) FROM ui_messages WHERE session_id = source.id)
      AND NOT EXISTS (
        SELECT 1 FROM ui_messages original LEFT JOIN ui_messages clone
          ON clone.session_id = ? AND clone.ordinal = original.ordinal
        WHERE original.session_id = source.id AND (
          clone.ordinal IS NULL OR clone.message_id <> original.message_id
          OR clone.payload_json <> original.payload_json
        )
      )
    ORDER BY source.created_at DESC, source.id DESC LIMIT 1`)
    .get(createdAt, sessionId, createdAt, sessionId, sessionId);
}

export function getSessionTokenUsage(sessionId, db = getGlobalDatabase()) {
  // Abort continuations display the old transcript. Include its requests up to
  // the fork time, while leaving each paid request stored exactly once.
  const sources = [];
  const seen = new Set();
  let currentId = String(sessionId || '');
  let through = '9999-12-31T23:59:59.999Z';
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    sources.push({ sessionId: currentId, through });
    const row = db.prepare('SELECT state_json, created_at FROM sessions WHERE id = ?').get(currentId);
    if (!row) break;
    const parent = JSON.parse(row.state_json || '{}').usageParent
      || legacyAbortUsageParent(db, currentId, row.created_at);
    if (!parent?.sessionId || !Number.isFinite(Date.parse(parent.through))) break;
    currentId = parent.sessionId;
    if (parent.through < through) through = parent.through;
  }
  const scope = `WITH usage_scope AS (SELECT json_extract(value, '$.sessionId') AS session_id,
    json_extract(value, '$.through') AS through FROM json_each(?)), scoped_usage AS (
    SELECT t.* FROM token_usage_records t WHERE t.session_id IN (SELECT session_id FROM usage_scope)
      AND EXISTS (SELECT 1 FROM usage_scope s WHERE s.session_id = t.session_id AND t.created_at <= s.through)
  ) `;
  const scopeJson = JSON.stringify(sources);
  const totals = db.prepare(scope + `SELECT COUNT(*) AS requests, COALESCE(SUM(reported), 0) AS reportedRequests,
    COALESCE(SUM(total_tokens), 0) AS totalTokens, COALESCE(SUM(input_tokens), 0) AS inputTokens,
    COALESCE(SUM(output_tokens), 0) AS outputTokens, COALESCE(SUM(cached_input_tokens), 0) AS cachedInputTokens,
    COALESCE(SUM(cache_write_input_tokens), 0) AS cacheWriteInputTokens,
    COALESCE(SUM(cache_reported), 0) AS cacheReportedRequests,
    COALESCE(SUM(CASE WHEN cache_reported = 1 THEN input_tokens ELSE 0 END), 0) AS cacheReportedInputTokens,
    SUM(duration_ms) AS durationMs, COUNT(duration_ms) AS timedRequests,
    SUM(waiting_ms) AS waitingMs, SUM(generating_ms) AS generatingMs,
    COUNT(generating_ms) AS splitTimedRequests,
    SUM(CASE WHEN generating_ms > 0 THEN output_tokens ELSE 0 END) AS timedOutputTokens,
    MIN(created_at) AS recordingSince
    FROM scoped_usage`).get(scopeJson);
  const models = db.prepare(scope + `SELECT model, provider, COUNT(*) AS requests, SUM(total_tokens) AS totalTokens
    FROM scoped_usage GROUP BY model, provider
    ORDER BY totalTokens DESC, model, provider`).all(scopeJson);
  const recent = db.prepare(scope + `SELECT id, created_at AS createdAt, model, total_tokens AS totalTokens,
    reported, duration_ms AS durationMs FROM scoped_usage
    ORDER BY created_at DESC, id DESC LIMIT 40`).all(scopeJson).reverse();
  return { sessionId: String(sessionId || ''), totals, models, recent };
}

function calendarYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1970 || year > 9999) throw new RangeError('Invalid year');
  return year;
}

function calendarMonth(value) {
  const month = Number(value);
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError('Invalid month');
  return month;
}

export function getTokenActivity({ timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone, now = new Date(), year = null, month = null } = {}) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayKey = (date) => {
    const parts = Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const today = dayKey(now);
  let start;
  let end = today;
  let queryFrom;
  let queryTo = now.toISOString();
  const selectedYear = year == null ? null : calendarYear(year);
  const selectedMonth = month == null ? null : calendarMonth(month);
  if (selectedMonth != null && selectedYear == null) throw new RangeError('Invalid month');
  if (selectedYear == null) {
    const startDate = new Date(`${end}T00:00:00Z`);
    const startMonth = startDate.getUTCMonth();
    startDate.setUTCFullYear(startDate.getUTCFullYear() - 1);
    if (startDate.getUTCMonth() !== startMonth) startDate.setUTCDate(0);
    startDate.setUTCDate(startDate.getUTCDate() + 1);
    start = startDate.toISOString().slice(0, 10);
    queryFrom = new Date(startDate.getTime() - 86400000).toISOString();
  } else {
    const pad = (value) => String(value).padStart(2, '0');
    const firstMonth = selectedMonth || 1;
    const lastMonth = selectedMonth || 12;
    start = `${selectedYear}-${pad(firstMonth)}-01`;
    end = `${selectedYear}-${pad(lastMonth)}-${pad(new Date(Date.UTC(selectedYear, lastMonth, 0)).getUTCDate())}`;
    if (start <= today && end > today) end = today;
    queryFrom = new Date(new Date(`${start}T00:00:00Z`).getTime() - 86400000).toISOString();
    queryTo = new Date(new Date(`${end}T00:00:00Z`).getTime() + 2 * 86400000).toISOString();
  }
  const db = getGlobalDatabase();
  const lifetime = db.prepare(`SELECT COALESCE(SUM(total_tokens), 0) AS totalTokens,
    COUNT(*) AS requests, COALESCE(SUM(1 - reported), 0) AS unreportedRequests,
    MIN(created_at) AS recordingSince FROM token_usage_records`).get();
  const bounds = db.prepare('SELECT MIN(created_at) AS firstAt, MAX(created_at) AS lastAt FROM token_usage_records').get();
  const yearNumbers = new Set([Number(today.slice(0, 4))]);
  if (bounds?.firstAt) yearNumbers.add(Number(dayKey(new Date(bounds.firstAt)).slice(0, 4)));
  if (bounds?.lastAt) yearNumbers.add(Number(dayKey(new Date(bounds.lastAt)).slice(0, 4)));
  const years = [];
  for (let value = Math.max(...yearNumbers); value >= Math.min(...yearNumbers); value -= 1) years.push(value);
  const rows = db.prepare(`SELECT created_at, input_tokens, output_tokens, total_tokens,
      cached_input_tokens, cache_write_input_tokens, reported
    FROM token_usage_records WHERE created_at >= ? AND created_at <= ? ORDER BY created_at`).all(
    queryFrom, queryTo);
  const days = new Map();
  let totalTokens = 0;
  let unreportedRequests = 0;
  for (const row of rows) {
    const date = dayKey(new Date(row.created_at));
    if (date < start || date > end) continue;
    const day = days.get(date) || { date, inputTokens: 0, outputTokens: 0, totalTokens: 0,
      cachedInputTokens: 0, cacheWriteInputTokens: 0, requests: 0, unreportedRequests: 0 };
    day.inputTokens += row.input_tokens;
    day.outputTokens += row.output_tokens;
    day.totalTokens += row.total_tokens;
    day.cachedInputTokens += row.cached_input_tokens;
    day.cacheWriteInputTokens += row.cache_write_input_tokens;
    day.requests += 1;
    day.unreportedRequests += 1 - row.reported;
    days.set(date, day);
    totalTokens += row.total_tokens;
    unreportedRequests += 1 - row.reported;
  }
  return {
    start, end, timeZone, today, year: selectedYear, month: selectedMonth,
    years, days: [...days.values()], totalTokens, unreportedRequests, lifetime,
  };
}
