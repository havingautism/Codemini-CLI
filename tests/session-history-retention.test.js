import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createSession, loadSession } from '../src/core/session-store.js';
import { createChatRuntime } from '../src/core/chat-runtime.js';
import { getGlobalDatabase, closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';

test('completing a new conversation retains over 100 old sessions even with legacy cleanup settings', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-history-retention-'));
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  const originalFetch = globalThis.fetch;
  process.env.CODEMINI_GLOBAL_DIR = dir;
  t.after(async () => {
    globalThis.fetch = originalFetch;
    closeSqliteDatabasesForTests(dir);
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true });
  });
  globalThis.fetch = async (_url, options) => JSON.parse(options.body).stream
    ? new Response('data: {"choices":[{"delta":{"content":"Completed."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
    : Response.json({ choices: [{ message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }] });
  const db = getGlobalDatabase();
  const insert = db.prepare('INSERT INTO sessions(id, created_at, updated_at, title, message_count) VALUES (?, ?, ?, ?, 1)');
  for (let i = 0; i < 105; i += 1) insert.run(`old-${i}`, '2020-01-01', '2020-01-01', 'old');
  const payload = JSON.stringify({ role: 'user', content: 'History to preserve' });
  db.prepare("INSERT INTO session_messages(session_id, ordinal, role, payload_json) VALUES ('old-0', 0, 'user', ?)").run(payload);
  db.prepare("INSERT INTO ui_messages(session_id, ordinal, payload_json) VALUES ('old-0', 0, ?)").run(payload);
  const session = await createSession(dir);
  session.title = 'Existing title';
  const runtime = await createChatRuntime({ session, model: 'test-model', systemPrompt: 'Test.', workspaceRoot: dir,
    config: {
      gateway: { base_url: 'https://example.test/v1', api_key: 'test', timeout_ms: 5000, max_retries: 0 },
      model: { name: 'test-model', max_context_tokens: 100000 }, sdk: { provider: 'openai-compatible' },
      context: { project_context_enabled: false, project_instructions_enabled: false },
      memory: { enabled: false, background_review: { enabled: false } },
      execution: { mode: 'normal', approval_mode: 'auto' },
      sessions: { auto_prune: true, max_sessions: 1, retention_days: 1 },
      ui: { language: 'en', reply_language: 'en' },
    } });
  await runtime.submitMessage({ text: 'Hello' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 106);
  assert.equal((await loadSession('old-0')).messages[0].content, 'History to preserve');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ui_messages WHERE session_id = 'old-0'").get().n, 1);
  assert.ok((await loadSession(session.id)).messages.some((message) => message.role === 'assistant'));
  await runtime.dispose();
});
