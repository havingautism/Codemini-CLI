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

export function getTokenActivity({ timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone, now = new Date() } = {}) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayKey = (date) => {
    const parts = Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const end = dayKey(now);
  const startDate = new Date(`${end}T00:00:00Z`);
  const month = startDate.getUTCMonth();
  startDate.setUTCFullYear(startDate.getUTCFullYear() - 1);
  if (startDate.getUTCMonth() !== month) startDate.setUTCDate(0);
  startDate.setUTCDate(startDate.getUTCDate() + 1);
  const start = startDate.toISOString().slice(0, 10);
  const db = getGlobalDatabase();
  const lifetime = db.prepare(`SELECT COALESCE(SUM(total_tokens), 0) AS totalTokens,
    COUNT(*) AS requests, COALESCE(SUM(1 - reported), 0) AS unreportedRequests,
    MIN(created_at) AS recordingSince FROM token_usage_records`).get();
  const rows = db.prepare(`SELECT created_at, input_tokens, output_tokens, total_tokens, reported
    FROM token_usage_records WHERE created_at >= ? AND created_at <= ? ORDER BY created_at`).all(
    new Date(startDate.getTime() - 86400000).toISOString(), now.toISOString());
  const days = new Map();
  let totalTokens = 0;
  let unreportedRequests = 0;
  for (const row of rows) {
    const date = dayKey(new Date(row.created_at));
    if (date < start || date > end) continue;
    const day = days.get(date) || { date, inputTokens: 0, outputTokens: 0, totalTokens: 0, requests: 0, unreportedRequests: 0 };
    day.inputTokens += row.input_tokens;
    day.outputTokens += row.output_tokens;
    day.totalTokens += row.total_tokens;
    day.requests += 1;
    day.unreportedRequests += 1 - row.reported;
    days.set(date, day);
    totalTokens += row.total_tokens;
    unreportedRequests += 1 - row.reported;
  }
  return { start, end, timeZone, days: [...days.values()], totalTokens, unreportedRequests, lifetime };
}
