import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { recordTokenUsage, getTokenActivity, getSessionTokenUsage } from '../src/core/token-usage-store.js';
import { withTokenUsageSession } from '../src/core/token-usage-context.js';
import { normalizeModelUsage } from '../src/core/model-usage.js';
import { createChatRuntime } from '../src/core/chat-runtime.js';
import { createSession } from '../src/core/session-store.js';
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
});

test('session usage is durable, isolated and preserves missing timing and cache coverage', async (t) => {
  const dir = await isolate(t);
  recordTokenUsage({ id: 'a', sessionId: 'alpha', model: 'one', usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 80 } }, timing: { requestSentAt: '2026-10-19T00:00:00Z', firstTokenAt: '2026-10-19T00:00:01Z', completedAt: '2026-10-19T00:00:03Z' } });
  recordTokenUsage({ id: 'b', sessionId: 'alpha', model: 'two' });
  recordTokenUsage({ sessionId: 'beta', usage: { total_tokens: 999 } });
  recordTokenUsage({ usage: { total_tokens: 777 } });
  getGlobalDatabase().exec('DELETE FROM sessions');
  closeSqliteDatabasesForTests(dir);
  const result = getSessionTokenUsage('alpha');
  assert.equal(result.totals.requests, 2);
  assert.equal(result.totals.reportedRequests, 1);
  assert.equal(result.totals.totalTokens, 110);
  assert.equal(result.totals.cacheReportedInputTokens, 100);
  assert.equal(result.totals.cachedInputTokens, 80);
  assert.equal(result.totals.durationMs, 3000);
  assert.equal(result.totals.waitingMs, 1000);
  assert.equal(result.totals.generatingMs, 2000);
  assert.equal(result.totals.timedRequests, 1);
  assert.equal(result.models.length, 2);
  assert.equal(getSessionTokenUsage('beta').totals.totalTokens, 999);
  assert.equal(getSessionTokenUsage('').totals.requests, 0);
  assert.equal(getSessionTokenUsage('missing').totals.durationMs, null);
});

test('normalized usage retains cache status and does not count cache writes twice', async (t) => {
  await isolate(t);
  const usage = normalizeModelUsage({ input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 7, cache_creation_input_tokens: 3 });
  recordTokenUsage({ sessionId: 'cache', usage });
  const totals = getSessionTokenUsage('cache').totals;
  assert.equal(totals.inputTokens, 15);
  assert.equal(totals.totalTokens, 17);
  assert.equal(totals.cacheWriteInputTokens, 3);
  assert.equal(totals.cachedInputTokens, 7);
  recordTokenUsage({ sessionId: 'plain', usage: normalizeModelUsage({ prompt_tokens: 20, completion_tokens: 2 }) });
  assert.equal(getSessionTokenUsage('plain').totals.cacheReportedRequests, 0);
});

test('version 18 usage table migrates without assigning historical records to a session', async (t) => {
  const dir = await isolate(t);
  const legacy = new DatabaseSync(path.join(dir, 'codemini.sqlite'));
  legacy.exec(`CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    INSERT INTO schema_meta VALUES ('schema_version', '18');
    CREATE TABLE token_usage_records (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, model TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL DEFAULT '', input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL, cached_input_tokens INTEGER NOT NULL, cache_write_input_tokens INTEGER NOT NULL,
      reported INTEGER NOT NULL) STRICT;
    INSERT INTO token_usage_records VALUES ('legacy', '2026-10-19T00:00:00Z', 'old', '', 10, 2, 12, 0, 0, 1);`);
  legacy.close();
  const row = getGlobalDatabase().prepare('SELECT * FROM token_usage_records').get();
  assert.equal(row.total_tokens, 12);
  assert.equal(row.session_id, '');
  assert.equal(row.duration_ms, null);
  assert.equal(row.cache_reported, null);
  recordTokenUsage({ sessionId: 'new', usage: { total_tokens: 3 } });
  assert.equal(getSessionTokenUsage('new').totals.totalTokens, 3);
  assert.equal(getTokenActivity().lifetime.totalTokens, 15);
});

test('parallel provider calls keep their own session association and record timing', async (t) => {
  await isolate(t);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (_url, options) => {
    const { model } = JSON.parse(options.body);
    await new Promise((resolve) => setTimeout(resolve, model === 'a' ? 15 : 1));
    return Response.json({ choices: [{ message: { content: 'done' }, finish_reason: 'stop' }], usage: { prompt_tokens: model === 'a' ? 10 : 20, completion_tokens: 2 } });
  };
  await Promise.all(['a', 'b'].map((sessionId) => withTokenUsageSession(sessionId, () => createChatCompletion({ baseUrl: 'https://example.test/v1', apiKey: 'test', model: sessionId, messages: [], maxRetries: 0 }))));
  assert.equal(getSessionTokenUsage('a').totals.totalTokens, 12);
  assert.equal(getSessionTokenUsage('b').totals.totalTokens, 22);
  assert.equal(getSessionTokenUsage('a').totals.timedRequests, 1);
  assert.equal(getSessionTokenUsage('a').totals.splitTimedRequests, 0);
});

test('session usage API requires an ID, returns only that session and caps recent requests', async (t) => {
  await isolate(t);
  for (let i = 0; i < 45; i++) recordTokenUsage({ id: String(i), sessionId: 'current', usage: { total_tokens: 1 } });
  recordTokenUsage({ sessionId: 'other', usage: { total_tokens: 1000 } });
  const handle = createWebRuntimeApi({ pool: {}, ensureSession: async () => {} });
  let status, body;
  const res = { writeHead(code) { status = code; }, end(value) { body = JSON.parse(value); } };
  await handle({ method: 'GET', url: '/api/usage/session?sessionId=current', headers: {} }, res);
  assert.equal(status, 200);
  assert.equal(body.totals.totalTokens, 45);
  assert.equal(body.recent.length, 40);
  await handle({ method: 'GET', url: '/api/usage/session', headers: {} }, res);
  assert.equal(status, 400);
});

test('a real runtime submission attaches completed usage to its current session', async (t) => {
  const dir = await isolate(t);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response('data: {"choices":[{"delta":{"content":"Done."},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":3}}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  const session = await createSession(dir);
  const runtime = await createChatRuntime({
    session, model: 'test-model', workspaceRoot: dir, systemPrompt: 'You are a test.',
    config: {
      sdk: { provider: 'openai-compatible' },
      gateway: { base_url: 'https://example.test/v1', api_key: 'test', timeout_ms: 5000, max_retries: 0 },
      model: { name: 'test-model', reasoning_enabled: false },
      context: { project_context_enabled: false, project_instructions_enabled: false, preflight_trigger_pct: 95, microcompact_enabled: false },
      execution: { mode: 'normal', approval_mode: 'auto' },
      memory: { enabled: false, background_review: { enabled: false } },
      ui: { language: 'en', reply_language: 'en' }, soul: { preset: 'default' },
    },
  });
  try {
    await runtime.submitMessage({ text: 'Say Done.' });
    const result = getSessionTokenUsage(session.id);
    assert.ok(result.totals.requests >= 1);
    assert.equal(result.totals.totalTokens, result.totals.requests * 15);
    assert.ok(result.totals.timedRequests >= 1);
    assert.equal(getSessionTokenUsage('other').totals.requests, 0);
  } finally { await runtime.dispose(); }
});
