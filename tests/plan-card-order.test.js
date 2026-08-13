import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendTextSegment,
  appendThinkingSegment,
  applyStreamEventToMessage,
} from '../codemini-web/shared/transcript-segments.js';
import {
  extractLatestTodoFromPlanSteps,
  layoutAnswerProcessWithPlans,
} from '../codemini-web/client/src/lib/answer-process.js';

test('appendTextSegment inserts before trailing create_plan card', () => {
  let segments = [
    {
      type: 'tools',
      cards: [{ id: 'p1', name: 'create_plan', status: 'running' }],
    },
  ];
  segments = appendThinkingSegment(segments, 'thinking first');
  segments = appendTextSegment(segments, 'create the plan now');
  assert.equal(segments[0].type, 'thinking');
  assert.equal(segments[1].type, 'text');
  assert.equal(segments[2].type, 'tools');
  assert.equal(segments[2].cards[0].name, 'create_plan');
});

test('tool_call_delta then text keeps preamble before create_plan', () => {
  let message = { id: 'm1', segments: [] };
  message = applyStreamEventToMessage(message, {
    type: 'assistant:tool_call_delta',
    toolCall: { id: 'c1', name: 'create_plan', arguments: '{}' },
  });
  message = applyStreamEventToMessage(message, {
    type: 'assistant:reasoning_delta',
    text: 'I should plan this',
  });
  message = applyStreamEventToMessage(message, {
    type: 'assistant:delta',
    text: '直接创建 plan',
  });
  assert.equal(message.segments[0].type, 'thinking');
  assert.equal(message.segments[1].type, 'text');
  assert.match(message.segments[1].text, /创建 plan/);
  assert.equal(message.segments[2].cards[0].name, 'create_plan');
});

test('layoutAnswerProcessWithPlans keeps plan between process and answer', () => {
  const layout = layoutAnswerProcessWithPlans([
    { type: 'thinking', text: 'hmm' },
    {
      type: 'tools',
      cards: [{ id: 'p1', name: 'create_plan', status: 'done', planRun: { phase: 'completed', steps: [] } }],
    },
    { type: 'text', text: 'final answer here' },
  ]);
  assert.equal(layout.hasFold, true);
  assert.equal(layout.items[0].type, 'fold');
  assert.equal(layout.items[0].groups[0].type, 'thinking');
  assert.equal(layout.items[1].type, 'group');
  assert.equal(layout.items[1].group.cards[0].name, 'create_plan');
  assert.equal(layout.items[2].group.type, 'text');
});

test('layoutAnswerProcessWithPlans hoists create_plan out of nested process fold', () => {
  const layout = layoutAnswerProcessWithPlans([
    {
      type: 'process',
      groups: [
        { type: 'thinking', text: 'planning' },
        {
          type: 'tools',
          cards: [
            { id: 'r1', name: 'read', status: 'done' },
            {
              id: 'p1',
              name: 'create_plan',
              status: 'done',
              planRun: { phase: 'completed', steps: [] },
            },
          ],
        },
      ],
    },
    { type: 'text', text: 'done' },
  ]);

  assert.equal(layout.hasFold, true);
  assert.equal(layout.items[0].type, 'fold');
  const foldTools = layout.items[0].groups
    .flatMap((group) => (group.type === 'process' ? group.groups : [group]))
    .filter((group) => group.type === 'tools')
    .flatMap((group) => group.cards || []);
  assert.equal(foldTools.some((card) => card.name === 'create_plan'), false);
  assert.equal(foldTools.some((card) => card.name === 'read'), true);

  assert.equal(layout.items[1].type, 'group');
  assert.equal(layout.items[1].group.cards[0].name, 'create_plan');
  assert.equal(layout.items[2].group.type, 'text');
});

test('layout keeps only the latest todo card outside the process fold', () => {
  const layout = layoutAnswerProcessWithPlans([
    { type: 'tools', cards: [
      { id: 'todo-1', name: 'tasks', arguments: { tasks: [{ content: 'Inspect', status: 'in_progress' }] } },
      { id: 'read-1', name: 'read', status: 'done' },
    ] },
    { type: 'process', groups: [{ type: 'tools', cards: [
      { id: 'todo-2', name: 'tasks', arguments: { tasks: [{ content: 'Inspect', status: 'completed' }] } },
    ] }] },
    { type: 'text', text: 'done' },
  ]);

  const todos = layout.items
    .filter((item) => item.type === 'group' && item.group?.type === 'tools')
    .flatMap((item) => item.group.cards || [])
    .filter((card) => card.name === 'tasks');
  assert.equal(todos.length, 1);
  assert.equal(todos[0].id, 'todo-2');
  assert.equal(layout.items.at(-2).group.cards[0].name, 'tasks');
  assert.equal(layout.items.at(-1).group.type, 'text');
});

test('subagent todo stays owned by its plan card and is removed from step details', () => {
  const firstTodo = { id: 'todo-1', name: 'tasks' };
  const latestTodo = { id: 'todo-2', name: 'tasks' };
  const readCard = { id: 'read-1', name: 'read' };
  const result = extractLatestTodoFromPlanSteps([
    {
      segments: [
        { type: 'tools', cards: [firstTodo, readCard] },
        { type: 'tools', cards: [latestTodo] },
      ],
    },
  ]);

  assert.equal(result.todoCard, latestTodo);
  assert.deepEqual(result.steps[0].segments, [{ type: 'tools', cards: [readCard] }]);
});

test('subagent assigned tasks stay visible before the child sends its first tasks update', () => {
  const assignedTasks = {
    id: 'sub-1-assigned-tasks',
    name: 'tasks',
    arguments: {
      tasks: [{ content: 'Inspect sources', status: 'pending' }],
    },
  };
  const result = extractLatestTodoFromPlanSteps([], assignedTasks);
  assert.equal(result.todoCard, assignedTasks);
});

test('subagent child tasks update replaces the initially assigned tasks card', () => {
  const assignedTasks = { id: 'assigned', name: 'tasks' };
  const childTasks = { id: 'child', name: 'tasks' };
  const result = extractLatestTodoFromPlanSteps(
    [{ segments: [{ type: 'tools', cards: [childTasks] }] }],
    assignedTasks,
  );
  assert.equal(result.todoCard, childTasks);
});
