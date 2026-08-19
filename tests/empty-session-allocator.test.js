import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createEmptySessionAllocator,
  findReusableEmptySession,
} from '../codemini-web/lib/empty-session-allocator.js';

test('findReusableEmptySession skips busy generating drafts', () => {
  const sessions = [
    { id: 'busy-empty', messageCount: 0, projectDir: '/repo' },
    { id: 'idle-empty', messageCount: 0, projectDir: '/repo' },
    { id: 'with-messages', messageCount: 2, projectDir: '/repo' },
  ];

  const reusable = findReusableEmptySession(sessions, {
    matchesProject: (session) => session.projectDir === '/repo',
    isBusy: (sessionId) => sessionId === 'busy-empty',
  });

  assert.equal(reusable.id, 'idle-empty');
});

test('findReusableEmptySession returns null when the only empty draft is busy', () => {
  const reusable = findReusableEmptySession(
    [{ id: 'busy-empty', messageCount: 0, projectDir: '/repo' }],
    {
      matchesProject: (session) => session.projectDir === '/repo',
      isBusy: () => true,
    },
  );

  assert.equal(reusable, null);
});

test('empty session allocator serializes concurrent creates for the same project', async () => {
  let created = 0;
  const sessions = [];
  const allocator = createEmptySessionAllocator({
    listSessions: async () => sessions.map((session) => ({ ...session })),
    loadSession: async (id) => sessions.find((session) => session.id === id),
    createSession: async (projectDir) => {
      created += 1;
      const session = {
        id: `created-${created}`,
        projectDir,
        messageCount: 0,
      };
      sessions.push(session);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return session;
    },
    projectKeyOf: (projectDir) => String(projectDir || ''),
    matchesProject: (session, projectDir) => session.projectDir === projectDir,
    isBusy: () => false,
  });

  const [first, second] = await Promise.all([
    allocator('/repo'),
    allocator('/repo'),
  ]);

  assert.equal(created, 1);
  assert.equal(first.session.id, 'created-1');
  assert.equal(second.session.id, 'created-1');
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
});
