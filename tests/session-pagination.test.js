import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getGlobalDatabase, closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import { getGeneralWorkspaceDir } from '../src/core/webui-sidebar-config.js';
import { getSessionSidebarSnapshot, getSessionGroupPage, decodeSessionCursor, GENERAL_SESSION_GROUP } from '../codemini-web/lib/session-pages.js';
import { mergeSessionPage, mergeSessionPageMetadata } from '../codemini-web/client/src/lib/session-ui-state.js';
import { createWebRuntimeApi } from '../codemini-web/server.js';

test('scoped cursor pages reach every session beyond 200, including timestamp ties and Windows path aliases', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-session-pages-'));
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = dir;
  t.after(async () => {
    closeSqliteDatabasesForTests(dir);
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true });
  });
  const db = getGlobalDatabase();
  const insert = db.prepare('INSERT INTO sessions(id, created_at, updated_at, title, project_dir, message_count) VALUES (?, ?, ?, ?, ?, ?)');
  const stamp = '2026-10-01T00:00:00.000Z';
  const general = getGeneralWorkspaceDir();
  for (let i = 0; i < 215; i++) {
    insert.run(`g-${String(i).padStart(3, '0')}`, stamp, stamp, 'General', general, 1);
    insert.run(`p-${String(i).padStart(3, '0')}`, stamp, stamp, 'Project', i % 2 ? 'E:\\repo' : 'e:/repo', 1);
  }
  insert.run('inactive', stamp, stamp, 'Inactive', 'E:\\hidden', 1);
  insert.run('draft', stamp, stamp, 'Draft', 'E:\\repo', 0);
  db.prepare("INSERT INTO session_messages(session_id, ordinal, role, content_text, payload_json) VALUES ('p-214', 0, 'user', 'first', '{}'), ('p-214', 1, 'assistant', 'latest preview', '{}')").run();
  const active = ['e:/repo'];
  const snapshot = getSessionSidebarSnapshot(active);
  assert.equal(snapshot.sessions.filter((s) => s.isGeneral).length, 10);
  assert.equal(snapshot.sessions.filter((s) => !s.isGeneral).length, 5);
  assert.equal(snapshot.sessions.find((s) => s.id === 'p-214').preview, 'latest preview');
  assert.equal(snapshot.pages['e:/repo'].hasMore, true);
  for (const groupKey of [GENERAL_SESSION_GROUP, 'e:/repo']) {
    let page = getSessionGroupPage({ groupKey, active });
    const ids = page.sessions.map((s) => s.id);
    // A new conversation at the front must not shift later pages or lose old rows.
    if (groupKey === GENERAL_SESSION_GROUP) insert.run('new-front', stamp, '2026-10-10T00:00:00.000Z', 'New', general, 1);
    while (page.hasMore) {
      page = getSessionGroupPage({ groupKey, active, cursor: decodeSessionCursor(page.nextCursor) });
      ids.push(...page.sessions.map((s) => s.id));
    }
    assert.equal(ids.length, 215);
    assert.equal(new Set(ids).size, 215);
    assert.ok(ids.includes(groupKey === GENERAL_SESSION_GROUP ? 'g-000' : 'p-000'));
  }
  assert.equal(getSessionGroupPage({ groupKey: 'e:/hidden', active }).sessions.length, 0);
  assert.throws(() => decodeSessionCursor('invalid'), /Invalid session cursor/);

  const handle = createWebRuntimeApi({ pool: { getSessionState: () => null }, ensureSession: async () => {},
    loadActiveProjects: async () => ({ active }), listSessions: async () => [] });
  const request = async (url) => {
    let status, data;
    const res = { writeHead(code) { status = code; }, end(value) { data = JSON.parse(value); } };
    assert.equal(await handle({ method: 'GET', url, headers: {} }, res), true);
    return { status, data };
  };
  const initial = await request('/api/sessions/sidebar');
  assert.equal(initial.status, 200);
  const cursor = initial.data.pages['e:/repo'].nextCursor;
  const next = await request(`/api/sessions/page?groupKey=e%3A%2Frepo&cursor=${cursor}`);
  assert.equal(next.status, 200);
  assert.equal(next.data.sessions.length, 5);
  assert.ok(next.data.sessions.every((s) => !initial.data.sessions.some((first) => first.id === s.id)));
  assert.equal((await request('/api/sessions/page?cursor=bad')).status, 400);
});

test('refresh and pagination preserve expanded history, live titles and in-flight cursors', () => {
  const current = [{ id: 'old', updatedAt: '2020-01-01', title: 'Old' }, { id: 'new', updatedAt: '2026-10-10', title: 'Live title' }];
  const next = mergeSessionPage(current, [{ id: 'new', updatedAt: '2026-10-09', title: '新会话' }, { id: 'older', updatedAt: '2019-01-01', title: 'Older' }]);
  assert.equal(next.length, 3);
  assert.equal(next[0].title, 'Live title');
  assert.equal(next.at(-1).id, 'older');
  const pages = { general: { expanded: true, nextCursor: 'older', hasMore: true }, project: { loading: true, nextCursor: 'busy' } };
  assert.deepEqual(mergeSessionPageMetadata(pages, { general: { nextCursor: 'first' }, project: { nextCursor: 'first' } }), pages);
  assert.deepEqual(mergeSessionPageMetadata(pages, { general: { nextCursor: 'first' } }), { general: pages.general });
  assert.deepEqual(mergeSessionPage([{ id: 'hidden', projectKey: '/hidden' }, { id: 'general', isGeneral: true }], [], [GENERAL_SESSION_GROUP]).map((s) => s.id), ['general']);
});
