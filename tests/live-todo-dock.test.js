import test from 'node:test';
import assert from 'node:assert/strict';

import { findLiveTodoDock } from '../codemini-web/client/src/lib/live-todo-dock.js';

const liveTodoMessage = {
  id: 'a1',
  role: 'assistant',
  segments: [
    {
      type: 'tools',
      cards: [{
        id: 'todo-1',
        name: 'tasks',
        arguments: {
          tasks: [
            { content: 'Inspect', status: 'in_progress' },
            { content: 'Build', status: 'pending' },
          ],
        },
      }],
    },
  ],
};

test('findLiveTodoDock is idle when the session is not busy', () => {
  assert.equal(findLiveTodoDock([liveTodoMessage], { busy: false }), null);
});

test('findLiveTodoDock pins the latest assistant todo while busy', () => {
  const dock = findLiveTodoDock([
    { id: 'u1', role: 'you', segments: [] },
    liveTodoMessage,
  ], { busy: true });
  assert.equal(dock.messageId, 'a1');
  assert.equal(dock.todos.length, 2);
  assert.equal(dock.todos[0].status, 'in_progress');
});

test('findLiveTodoDock ignores completed history when the live assistant has no todo', () => {
  const dock = findLiveTodoDock([
    liveTodoMessage,
    { id: 'u2', role: 'you', segments: [] },
    { id: 'a2', role: 'assistant', segments: [{ type: 'text', text: 'working' }] },
  ], { busy: true });
  assert.equal(dock, null);
});

test('findLiveTodoDock still pins when a queued user message is trailing', () => {
  const dock = findLiveTodoDock([
    liveTodoMessage,
    { id: 'u2', role: 'you', segments: [] },
  ], { busy: true });
  assert.equal(dock.messageId, 'a1');
});
