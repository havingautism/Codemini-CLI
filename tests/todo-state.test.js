import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeTodos,
  countTodosByStatus,
  normalizeTodos,
  settleTodoCardsInSegments,
  settleTodoToolCard,
  settleTodosCompleted,
} from '../src/core/todo-state.js';
import { getBuiltinTools } from '../src/core/tools.js';
import { createToolRegistry } from '../src/core/tool-registry.js';

test('normalizeTodos keeps items that omit activeForm', () => {
  assert.deepEqual(
    normalizeTodos([{ content: 'Inspect sources', status: 'in_progress' }]),
    [{ content: 'Inspect sources', activeForm: '', status: 'in_progress' }],
  );
});

test('settleTodosCompleted marks leftover items completed without adding work', () => {
  assert.deepEqual(
    settleTodosCompleted([
      { content: 'Inspect', status: 'completed' },
      { content: 'Return a summary', status: 'in_progress' },
      { content: 'Skip me', status: 'pending' },
    ]).map((item) => item.status),
    ['completed', 'completed', 'completed'],
  );
});

test('settleTodoToolCard fills leftover tasks on arguments and structured results', () => {
  const settled = settleTodoToolCard({
    name: 'tasks',
    status: 'done',
    arguments: {
      tasks: [
        { content: 'Inspect', status: 'completed' },
        { content: 'Return a summary', status: 'in_progress' },
      ],
    },
    result: {
      newTodos: [
        { content: 'Inspect', status: 'completed' },
        { content: 'Return a summary', status: 'in_progress' },
      ],
    },
  });
  assert.deepEqual(
    settled.arguments.tasks.map((item) => item.status),
    ['completed', 'completed'],
  );
  assert.deepEqual(
    settled.result.newTodos.map((item) => item.status),
    ['completed', 'completed'],
  );
  assert.equal(settleTodoToolCard({ name: 'read', arguments: { path: 'a.js' } }).name, 'read');
});

test('settleTodoCardsInSegments only rewrites tasks cards', () => {
  const segments = settleTodoCardsInSegments([
    {
      type: 'tools',
      cards: [
        {
          name: 'tasks',
          arguments: { tasks: [{ content: 'Return a summary', status: 'in_progress' }] },
        },
        { name: 'read', status: 'done' },
      ],
    },
  ]);
  assert.equal(segments[0].cards[0].arguments.tasks[0].status, 'completed');
  assert.equal(segments[0].cards[1].status, 'done');
});

test('canonicalizeTodos rejects empty and duplicate content', () => {
  assert.equal(
    canonicalizeTodos([{ content: '   ', status: 'pending' }]).error,
    'invalid todo: `content` must be a non-empty string',
  );
  assert.match(
    canonicalizeTodos([
      { content: 'Inspect', status: 'completed' },
      { content: 'Inspect', status: 'pending' },
    ]).error,
    /duplicate content/,
  );
});

test('tasks whole-list replace returns compact counts and accepts parallel in_progress', async () => {
  let stored = [];
  const bundle = getBuiltinTools({
    workspaceRoot: process.cwd(),
    config: {},
    getTodos: () => stored,
    onTodosUpdate: (todos) => {
      stored = todos;
    },
  });
  try {
    const registry = createToolRegistry(bundle);
    assert.equal(registry.isConcurrencySafe('tasks', { tasks: [] }), true);

    const result = await bundle.handlers.tasks({
      tasks: [
        { content: 'Read package.json', status: 'completed' },
        { content: 'Read README.md', status: 'in_progress' },
        { content: 'Return a summary', status: 'in_progress' },
      ],
    });
    assert.equal(result.ok, true);
    assert.equal(result.newTodos.length, 3);
    assert.deepEqual(countTodosByStatus(result.newTodos), {
      pending: 0,
      inProgress: 2,
      completed: 1,
      total: 3,
    });
    assert.equal(
      bundle.formatters.tasks(result),
      'Updated todo list: 0 pending, 2 in progress, 1 completed.',
    );
  } finally {
    await bundle.dispose?.();
  }
});
