import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  activateProjectInList,
  buildConversationStartSidebarEntry,
  buildVisibleProjectGroups,
  displaySessionTitle,
  filterProjectGroupsByActive,
  mergeFetchedSessions,
  patchSidebarSession,
  upsertSidebarSession,
} from '../codemini-web/client/src/lib/session-ui-state.js';

test('new chat drafts stay out of the sidebar until conversation starts', () => {
  const sessions = [
    { id: 'old', title: 'Old chat', messageCount: 2, isGeneral: true },
  ];
  // Creating/opening a draft must not insert a zero-message bubble.
  assert.deepEqual(
    sessions.filter((session) => Number(session.messageCount || 0) > 0),
    sessions,
  );
});

test('conversation start inserts a sidebar bubble from the first user turn', () => {
  const entry = buildConversationStartSidebarEntry({
    sessionId: 'draft-1',
    text: '帮我修一下项目里的登录回调',
    isGeneral: false,
    projectDir: 'E:/repo',
    projectKey: 'E:/repo',
  });

  assert.equal(entry.id, 'draft-1');
  assert.equal(entry.messageCount, 1);
  assert.equal(entry.isGeneral, false);
  assert.equal(entry.projectKey, 'e:/repo');
  assert.match(entry.title, /登录回调/);
  assert.match(entry.title, /^💬 /u);

  const next = upsertSidebarSession(
    [{ id: 'old', title: 'Old', messageCount: 3, isGeneral: true }],
    entry,
  );
  assert.equal(next[0].id, 'draft-1');
  assert.equal(next[0].messageCount, 1);
  assert.equal(next[1].id, 'old');
});

test('conversation start keeps general chats in the general section', () => {
  const entry = buildConversationStartSidebarEntry({
    sessionId: 'g1',
    text: '今天天气怎么样',
    isGeneral: true,
  });
  assert.equal(entry.isGeneral, true);
  assert.equal(entry.projectDir, undefined);
  assert.equal(entry.projectKey, undefined);
});

test('later turns update metadata without resetting an existing title', () => {
  const next = upsertSidebarSession(
    [
      {
        id: 's1',
        title: 'Web UI 标题生成',
        messageCount: 2,
        isGeneral: true,
      },
    ],
    {
      id: 's1',
      messageCount: 3,
      updatedAt: '2026-07-12T12:00:00.000Z',
    },
  );

  assert.equal(next.length, 1);
  assert.equal(next[0].title, 'Web UI 标题生成');
  assert.equal(next[0].messageCount, 3);
  assert.equal(next[0].updatedAt, '2026-07-12T12:00:00.000Z');
});

test('mergeFetchedSessions keeps live title ahead of stale fetch after submit:done', () => {
  const current = [
    {
      id: 's1',
      title: '修复登录回调',
      messageCount: 2,
      updatedAt: '2026-07-13T12:00:05.000Z',
    },
  ];
  const fetched = [
    {
      id: 's1',
      title: '帮我修一下项目里的登录回调',
      messageCount: 2,
      updatedAt: '2026-07-13T12:00:01.000Z',
    },
  ];

  const merged = mergeFetchedSessions(current, fetched);
  assert.equal(merged[0].title, '修复登录回调');
  assert.equal(merged[0].updatedAt, '2026-07-13T12:00:05.000Z');
});

test('mergeFetchedSessions keeps non-default live title over default fetch title', () => {
  const merged = mergeFetchedSessions(
    [{ id: 's1', title: '修复登录回调', updatedAt: '2026-07-13T12:00:00.000Z' }],
    [{ id: 's1', title: '新会话', updatedAt: '2026-07-13T12:00:10.000Z' }],
  );
  assert.equal(merged[0].title, '修复登录回调');
});

test('patchSidebarSession updates a title without moving the session', () => {
  const sessions = [
    { id: 'newer', title: '较新会话', updatedAt: '2026-07-13T12:00:00.000Z' },
    { id: 'older', title: '旧标题', updatedAt: '2026-07-01T12:00:00.000Z' },
  ];
  const next = patchSidebarSession(sessions, {
    id: 'older',
    title: '🛠️ 新标题',
  });
  assert.deepEqual(next.map((session) => session.id), ['newer', 'older']);
  assert.equal(next[1].title, '🛠️ 新标题');
  assert.equal(next[1].updatedAt, '2026-07-01T12:00:00.000Z');
});

test('displaySessionTitle preserves generated emoji and defaults legacy titles', () => {
  assert.equal(displaySessionTitle('🔧 标题生成修复'), '🔧 标题生成修复');
  assert.equal(displaySessionTitle('旧会话标题'), '💬 旧会话标题');
});

test('mergeFetchedSessions keeps a conversation added while an older fetch was in flight', () => {
  const merged = mergeFetchedSessions(
    [
      { id: 'new', title: '刚开始的会话', messageCount: 1 },
      { id: 'old', title: '旧会话', messageCount: 2 },
    ],
    [{ id: 'old', title: '旧会话', messageCount: 2 }],
    { sessionIdsAtRequestStart: new Set(['old']) },
  );

  assert.deepEqual(merged.map((session) => session.id), ['new', 'old']);
});

test('mergeFetchedSessions does not retain a session missing before the fetch started', () => {
  const merged = mergeFetchedSessions(
    [{ id: 'deleted', title: '已删除会话', messageCount: 2 }],
    [],
    { sessionIdsAtRequestStart: new Set(['deleted']) },
  );

  assert.deepEqual(merged, []);
});

test('mergeFetchedSessions keeps an existing conversation updated during the fetch', () => {
  const merged = mergeFetchedSessions(
    [
      {
        id: 'active',
        title: '异步生成的新标题',
        messageCount: 2,
        updatedAt: '2026-07-13T12:00:05.000Z',
      },
    ],
    [],
    {
      sessionIdsAtRequestStart: new Set(['active']),
      requestStartedAt: Date.parse('2026-07-13T12:00:01.000Z'),
    },
  );

  assert.deepEqual(merged.map((session) => session.id), ['active']);
});

test('filterProjectGroupsByActive hides a project removed from the active area', () => {
  const entries = [
    ['/Users/me/alpha', [{ id: 'a1' }]],
    ['/Users/me/beta', [{ id: 'b1' }]],
  ];
  const visible = filterProjectGroupsByActive(entries, ['/Users/me/beta']);
  assert.deepEqual(
    visible.map(([key]) => key),
    ['/Users/me/beta'],
  );
});

test('filterProjectGroupsByActive hides every project when the active list is empty', () => {
  const entries = [['/Users/me/alpha', [{ id: 'a1' }]]];
  assert.deepEqual(filterProjectGroupsByActive(entries, []), []);
});

test('filterProjectGroupsByActive keeps fetch order until active projects are ready', () => {
  const entries = [
    ['/Users/me/alpha', [{ id: 'a1' }]],
    ['/Users/me/beta', [{ id: 'b1' }]],
  ];
  const visible = filterProjectGroupsByActive(entries, ['/Users/me/beta'], {
    ready: false,
  });
  assert.deepEqual(
    visible.map(([key]) => key),
    ['/Users/me/alpha', '/Users/me/beta'],
  );
});

test('filterProjectGroupsByActive still hides after mergeFetchedSessions keeps a deactivated project', () => {
  const merged = mergeFetchedSessions(
    [
      {
        id: 'gone',
        title: '已移除项目的会话',
        projectKey: '/Users/me/alpha',
        messageCount: 2,
        updatedAt: '2026-07-13T12:00:05.000Z',
      },
    ],
    [],
    {
      sessionIdsAtRequestStart: new Set(['gone']),
      requestStartedAt: Date.parse('2026-07-13T12:00:01.000Z'),
    },
  );
  const groups = new Map();
  for (const session of merged) {
    const key = session.projectKey;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(session);
  }
  assert.equal(filterProjectGroupsByActive([...groups.entries()], []).length, 0);
});

test('activateProjectInList pins a newly opened project to the front of the active area', () => {
  const next = activateProjectInList(
    ['/Users/me/old'],
    '/Users/me/new-app',
  );
  assert.deepEqual(next, ['/Users/me/new-app', '/Users/me/old']);
});

test('activateProjectInList re-adds a previously removed project without duplicating it', () => {
  const next = activateProjectInList(
    ['/Users/me/kept'],
    '/Users/me/kept',
  );
  assert.deepEqual(next, ['/Users/me/kept']);
});

test('buildVisibleProjectGroups shows an opened project folder with no conversation history', () => {
  const visible = buildVisibleProjectGroups({
    sessions: [
      {
        id: 'draft',
        projectKey: '/Users/me/new-app',
        projectDir: '/Users/me/new-app',
        messageCount: 0,
      },
    ],
    activeProjectDirs: ['/Users/me/new-app'],
    ready: true,
  });

  assert.deepEqual(
    visible.map(([key, sessions]) => [key, sessions.map((session) => session.id)]),
    [['/Users/me/new-app', []]],
  );
});

test('buildVisibleProjectGroups lists existing history under a re-added project but keeps empty drafts out', () => {
  const visible = buildVisibleProjectGroups({
    sessions: [
      {
        id: 'old-chat',
        projectKey: '/Users/me/readded',
        messageCount: 4,
      },
      {
        id: 'new-draft',
        projectKey: '/Users/me/readded',
        messageCount: 0,
      },
    ],
    activeProjectDirs: ['/Users/me/readded'],
    ready: true,
  });

  assert.deepEqual(
    visible.map(([key, sessions]) => [key, sessions.map((session) => session.id)]),
    [['/Users/me/readded', ['old-chat']]],
  );
});

test('opening a project pins the resolved cwd only after a successful open', async () => {
  const app = await fs.readFile('codemini-web/client/src/App.jsx', 'utf8');
  const start = app.indexOf('const handleOpenProject = useCallback(');
  assert.ok(start >= 0, 'handleOpenProject must exist');
  const handle = app.slice(start, start + 1100);

  const pinAfterResult = handle.indexOf(
    'const result = await actions.openProject(path, options);',
  );
  assert.ok(pinAfterResult >= 0, 'openProject result must be awaited first');
  const pinBlock = handle.slice(pinAfterResult);
  assert.match(
    pinBlock,
    /result\?\.ok && result\.cwd/,
    'pin must be gated on a successful open with a resolved cwd',
  );
  assert.match(
    pinBlock,
    /dir:\s*result\.cwd/,
    'pin must use the server-resolved cwd, not the raw input path',
  );
  const guardIndex = handle.indexOf(
    'if (!openingGeneral && result?.ok && result.cwd)',
  );
  const pinIndex = handle.indexOf('setActivateProject(');
  assert.ok(
    pinIndex > guardIndex && guardIndex > pinAfterResult,
    'pin must be called after the await and inside the success guard only',
  );
});

