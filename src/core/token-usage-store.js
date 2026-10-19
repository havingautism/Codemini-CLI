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

export function getSessionTokenUsage(sessionId) {
  const db = getGlobalDatabase();
  const totals = db.prepare(`SELECT COUNT(*) AS requests, COALESCE(SUM(reported), 0) AS reportedRequests,
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
    FROM token_usage_records WHERE session_id = ? AND session_id <> ''`).get(String(sessionId || ''));
  const models = db.prepare(`SELECT model, provider, COUNT(*) AS requests, SUM(total_tokens) AS totalTokens
    FROM token_usage_records WHERE session_id = ? AND session_id <> '' GROUP BY model, provider
    ORDER BY totalTokens DESC, model, provider`).all(String(sessionId || ''));
  const recent = db.prepare(`SELECT id, created_at AS createdAt, model, total_tokens AS totalTokens,
    reported, duration_ms AS durationMs FROM token_usage_records WHERE session_id = ? AND session_id <> ''
    ORDER BY created_at DESC, id DESC LIMIT 40`).all(String(sessionId || '')).reverse();
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
