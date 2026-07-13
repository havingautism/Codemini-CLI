import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildConversationStartSidebarEntry,
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
