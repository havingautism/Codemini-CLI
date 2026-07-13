import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildConversationStartSidebarEntry,
  displaySessionTitle,
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
