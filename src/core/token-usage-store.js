import { randomUUID } from 'node:crypto';
import { getGlobalDatabase } from './sqlite-database.js';
import { normalizeModelUsage } from './model-usage.js';

// No session foreign key: deleting or compacting a transcript must not erase usage.
export function recordTokenUsage({ id = randomUUID(), createdAt = new Date().toISOString(), model = '', provider = '', usage } = {}) {
  const normalized = normalizeModelUsage(usage);
  const timestamp = new Date(createdAt).toISOString();
  getGlobalDatabase().prepare(`
    INSERT OR IGNORE INTO token_usage_records
      (id, created_at, model, provider, input_tokens, output_tokens, total_tokens,
       cached_input_tokens, cache_write_input_tokens, reported)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, timestamp, String(model), String(provider), normalized?.inputTokens || 0,
    normalized?.outputTokens || 0, normalized?.totalTokens || 0,
    normalized?.cachedInputTokens || 0, normalized?.cacheWriteInputTokens || 0, normalized ? 1 : 0);
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
