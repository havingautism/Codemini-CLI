import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { recordTokenUsage, getTokenActivity } from '../src/core/token-usage-store.js';
import { getGlobalDatabase, closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import { createChatCompletion, createChatCompletionStream } from '../src/core/provider/index.js';
import { buildActivityGrid } from '../codemini-web/client/src/lib/token-activity.js';
import { createWebRuntimeApi } from '../codemini-web/server.js';

async function isolate(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-token-activity-'));
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = dir;
  t.after(async () => {
    closeSqliteDatabasesForTests(dir);
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test('usage survives restart and transcript deletion, deduplicates IDs and groups by viewer timezone', async (t) => {
  const dir = await isolate(t);
  const record = { id: 'one', createdAt: '2026-10-09T18:00:00Z', usage: { prompt_tokens: 10, completion_tokens: 4 } };
  recordTokenUsage(record);
  recordTokenUsage(record);
  recordTokenUsage({ id: 'old', createdAt: '2024-01-01T00:00:00Z', usage: { total_tokens: 20 } });
  recordTokenUsage({ id: 'unknown', createdAt: '2026-10-09T17:00:00Z' });
  getGlobalDatabase().exec('DELETE FROM sessions');
  closeSqliteDatabasesForTests(dir);
  const now = new Date('2026-10-10T03:00:00Z');
  const china = getTokenActivity({ timeZone: 'Asia/Shanghai', now });
  assert.equal(china.days[0].date, '2026-10-10');
  assert.equal(china.days[0].totalTokens, 14);
  assert.equal(china.days[0].inputTokens, 10);
  assert.equal(china.days[0].outputTokens, 4);
  assert.equal(china.days[0].requests, 2);
  assert.equal(china.unreportedRequests, 1);
  assert.equal(china.lifetime.totalTokens, 34);
  assert.equal(china.lifetime.requests, 3);
  assert.equal(getTokenActivity({ timeZone: 'UTC', now }).days[0].date, '2026-10-09');
  assert.throws(() => getTokenActivity({ timeZone: 'bad/zone', now }), RangeError);
  assert.equal(getTokenActivity({ timeZone: 'UTC', now: new Date('2024-02-29T12:00:00Z') }).start, '2023-03-01');
});

test('missing, null and malformed usage remain unreported rather than fabricated zero usage', async (t) => {
  await isolate(t);
  for (const usage of [null, {}, { total_tokens: null }, { total_tokens: 'invalid' }]) recordTokenUsage({ usage });
  recordTokenUsage({ usage: { total_tokens: 0 } });
  const activity = getTokenActivity();
  assert.equal(activity.lifetime.requests, 5);
  assert.equal(activity.lifetime.unreportedRequests, 4);
  assert.equal(activity.lifetime.totalTokens, 0);
});

test('OpenAI streaming and Anthropic non-streaming calls each record once, including cache tokens', async (t) => {
  await isolate(t);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response('data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":3,"total_tokens":13}}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  await createChatCompletionStream({ baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test', messages: [], maxRetries: 0 });
  globalThis.fetch = async () => Response.json({ content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 7, cache_creation_input_tokens: 3 } });
  await createChatCompletion({ baseUrl: 'https://example.test', apiKey: 'test', sdkProvider: 'anthropic', model: 'test', messages: [{ role: 'user', content: 'hi' }], maxRetries: 0 });
  const activity = getTokenActivity();
  assert.equal(activity.lifetime.requests, 2);
  assert.equal(activity.lifetime.totalTokens, 30);
  const cached = getGlobalDatabase().prepare('SELECT * FROM token_usage_records WHERE provider = ?').get('anthropic');
  assert.equal(cached.cached_input_tokens, 7);
  assert.equal(cached.cache_write_input_tokens, 3);
});

test('calendar handles DST, leap days, partial weeks and empty data without inventing activity', () => {
  const activity = { start: '2024-02-29', end: '2025-02-28', days: [{ date: '2024-02-29', totalTokens: 10, requests: 1 }, { date: '2025-02-28', totalTokens: 20, requests: 1 }] };
  const grid = buildActivityGrid(activity);
  const cells = grid.weeks.flat().filter((cell) => !cell.outside);
  assert.equal(cells.length, 366);
  assert.equal(grid.weeks[0][0].date, '2024-02-26');
  assert.equal(grid.weeks[0][0].outside, true);
  assert.equal(grid.weeks.at(-1).at(-1).date, '2025-03-02');
  assert.equal(grid.weeks.at(-1).at(-1).outside, true);
  assert.equal(new Set(cells.map((cell) => cell.date)).size, 366);
  assert.equal(cells.reduce((sum, cell) => sum + cell.totalTokens, 0), 30);
  assert.equal(buildActivityGrid(activity, true).weeks.flat().reduce((sum, cell) => sum + cell.totalTokens, 0), 30);
  assert.ok(buildActivityGrid({ ...activity, days: [] }).weeks.flat().every((cell) => cell.level === 0));
});

test('Web activity API returns recorded totals and rejects invalid timezones', async (t) => {
  await isolate(t);
  recordTokenUsage({ usage: { total_tokens: 42 } });
  const handle = createWebRuntimeApi({ pool: {}, ensureSession: async () => {} });
  const request = async (timeZone) => {
    let status;
    let body;
    const res = { writeHead(code) { status = code; }, end(value) { body = JSON.parse(value); } };
    assert.equal(await handle({ method: 'GET', url: `/api/usage/activity?timeZone=${encodeURIComponent(timeZone)}`, headers: {} }, res), true);
    return { status, body };
  };
  const result = await request('Asia/Shanghai');
  assert.equal(result.status, 200);
  assert.equal(result.body.lifetime.totalTokens, 42);
  assert.equal(result.body.timeZone, 'Asia/Shanghai');
  assert.equal((await request('invalid')).status, 400);
  assert.ok(Array.isArray(result.body.years));
  let status;
  const res = { writeHead(code) { status = code; }, end() {} };
  assert.equal(await handle({ method: 'GET', url: '/api/usage/activity?timeZone=UTC&month=13', headers: {} }, res), true);
  assert.equal(status, 400);
});

test('cache read stays inside input while weekly totals add every request', async (t) => {
  await isolate(t);
  recordTokenUsage({ id: 'cached', createdAt: '2026-10-10T02:00:00Z', usage: { prompt_tokens: 10, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 6 } } });
  recordTokenUsage({ id: 'plain', createdAt: '2026-10-10T03:00:00Z', usage: { prompt_tokens: 5, completion_tokens: 1 } });
  const activity = getTokenActivity({ timeZone: 'Asia/Shanghai', now: new Date('2026-10-11T00:00:00Z'), year: 2026, month: 10 });
  const day = activity.days.find((item) => item.date === '2026-10-10');
  assert.equal(day.inputTokens, 15);
  assert.equal(day.cachedInputTokens, 6);
  assert.equal(day.outputTokens, 5);
  assert.equal(day.totalTokens, 20);
  const week = buildActivityGrid(activity, true).weeks.flat().find((cell) => cell.date <= '2026-10-10' && cell.end >= '2026-10-10');
  assert.equal(week.inputTokens, 15);
  assert.equal(week.cachedInputTokens, 6);
  assert.equal(week.outputTokens, 5);
});

test('year and month filters keep lifetime totals and reject invalid ranges', async (t) => {
  await isolate(t);
  recordTokenUsage({ id: 'past', createdAt: '2025-06-15T12:00:00Z', usage: { total_tokens: 5 } });
  recordTokenUsage({ id: 'recent', createdAt: '2026-10-09T18:00:00Z', usage: { total_tokens: 7 } });
  const now = new Date('2026-10-11T04:00:00Z');
  const year = getTokenActivity({ timeZone: 'Asia/Shanghai', now, year: 2026 });
  assert.equal(year.start, '2026-01-01');
  assert.equal(year.end, '2026-10-11');
  assert.equal(year.days.length, 1);
  assert.equal(year.days[0].date, '2026-10-10');
  assert.equal(year.days[0].totalTokens, 7);
  assert.equal(year.lifetime.totalTokens, 12);
  assert.deepEqual(year.years, [2026, 2025]);
  const month = getTokenActivity({ timeZone: 'Asia/Shanghai', now, year: 2026, month: 10 });
  assert.equal(month.start, '2026-10-01');
  assert.equal(month.end, '2026-10-11');
  assert.equal(month.totalTokens, 7);
  const past = getTokenActivity({ timeZone: 'UTC', now, year: 2025 });
  assert.equal(past.start, '2025-01-01');
  assert.equal(past.end, '2025-12-31');
  assert.equal(past.days[0].totalTokens, 5);
  assert.equal(past.lifetime.totalTokens, 12);
  assert.throws(() => getTokenActivity({ year: 2026, month: 13, now }), RangeError);
  assert.throws(() => getTokenActivity({ month: 1, now }), RangeError);
});
