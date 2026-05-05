import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { getSessionsDir } from '../src/core/paths.js';
import { listSessions, loadSession, saveSession } from '../src/core/session-store.js';

async function withTempConfigDir(run) {
  const prev = process.env.CODEMINI_GLOBAL_DIR;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-global-'));
  process.env.CODEMINI_GLOBAL_DIR = dir;
  try {
    await run(dir);
  } finally {
    if (prev === undefined) {
      delete process.env.CODEMINI_GLOBAL_DIR;
    } else {
      process.env.CODEMINI_GLOBAL_DIR = prev;
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('session-store persists snapshots as jsonl and loads the latest snapshot', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    const id = 'session-jsonl-latest';
    await saveSession({
      id,
      createdAt: '2026-04-01T10:00:00.000Z',
      updatedAt: '2026-04-01T10:00:00.000Z',
      messages: [{ role: 'user', content: 'first' }]
    });
    await saveSession({
      id,
      createdAt: '2026-04-01T10:00:00.000Z',
      updatedAt: '2026-04-01T10:01:00.000Z',
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'second' }
      ]
    });

    const loaded = await loadSession(id);
    assert.equal(loaded.id, id);
    assert.equal(loaded.title, 'first');
    assert.equal(loaded.messages.length, 2);
    assert.equal(loaded.messages[1].content, 'second');

    const jsonlPath = path.join(getSessionsDir(), `${id}.jsonl`);
    const raw = await fs.readFile(jsonlPath, 'utf8');
    const lines = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    assert.equal(lines.length, 2);
  });
});

test('session-store derives titles and preserves tool metadata', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    const id = 'session-title-tool-meta';
    await saveSession({
      id,
      createdAt: '2026-04-01T10:00:00.000Z',
      updatedAt: '2026-04-01T10:00:00.000Z',
      model: 'main-model',
      mode: 'auto',
      messages: [
        { role: 'user', content: '请总结这个项目的 Web UI' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call-read',
              type: 'function',
              function: { name: 'read', arguments: '{"path":"README.md"}' },
              durationMs: 42,
              summary: 'content from README.md lines 1-20',
              status: 'done'
            }
          ]
        },
        {
          role: 'tool',
          tool_call_id: 'call-read',
          content: '{"path":"README.md","phase":"content","start_line":1,"end_line":20,"total_lines":20}',
          tool_duration_ms: 42,
          tool_summary: 'content from README.md lines 1-20',
          tool_status: 'done'
        }
      ]
    });

    const loaded = await loadSession(id);
    assert.equal(loaded.title, '请总结这个项目的 Web UI');
    assert.equal(loaded.model, 'main-model');
    assert.equal(loaded.mode, 'auto');
    assert.equal(loaded.messages[1].tool_calls[0].durationMs, 42);
    assert.equal(loaded.messages[1].tool_calls[0].summary, 'content from README.md lines 1-20');
    assert.equal(loaded.messages[2].tool_duration_ms, 42);

    const listed = await listSessions(10);
    const item = listed.find((entry) => entry.id === id);
    assert.equal(item.title, '请总结这个项目的 Web UI');
    assert.equal(item.model, 'main-model');
  });
});

test('session-store can recover from a corrupted trailing jsonl line', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    const id = 'session-jsonl-corrupt-tail';
    await saveSession({
      id,
      createdAt: '2026-04-01T10:00:00.000Z',
      updatedAt: '2026-04-01T10:00:00.000Z',
      messages: [{ role: 'user', content: 'safe snapshot' }]
    });

    const jsonlPath = path.join(getSessionsDir(), `${id}.jsonl`);
    await fs.appendFile(jsonlPath, '{"id":"broken"', 'utf8');

    const loaded = await loadSession(id);
    assert.equal(loaded.id, id);
    assert.equal(loaded.messages.length, 1);
    assert.equal(loaded.messages[0].content, 'safe snapshot');

    const listed = await listSessions(10);
    assert.ok(listed.some((item) => item.id === id));
  });
});

test('session-store still supports legacy .json session files', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    const id = 'session-legacy-json';
    const sessionsDir = getSessionsDir();
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(
      path.join(sessionsDir, `${id}.json`),
      JSON.stringify({
        id,
        createdAt: '2026-04-01T10:00:00.000Z',
        updatedAt: '2026-04-01T10:02:00.000Z',
        messages: [{ role: 'user', content: 'legacy data' }]
      }),
      'utf8'
    );

    const loaded = await loadSession(id);
    assert.equal(loaded.id, id);
    assert.equal(loaded.messages.length, 1);
    assert.equal(loaded.messages[0].content, 'legacy data');
  });
});
