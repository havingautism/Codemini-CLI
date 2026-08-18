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

test('appendTextSegment parks preamble before trailing request_user_input', () => {
  let segments = [
    {
      type: 'tools',
      cards: [{ id: 'q1', name: 'request_user_input', status: 'running' }],
    },
  ];
  segments = appendThinkingSegment(segments, 'thinking first');
  segments = appendTextSegment(segments, '两个方案：最小改动 / 嵌套树');
  assert.equal(segments[0].type, 'text');
  assert.match(segments[0].text, /两个方案/);
  assert.equal(segments[1].type, 'tools');
  assert.equal(segments[1].cards[0].name, 'request_user_input');
  assert.equal(segments[2].type, 'thinking');
});

test('layout keeps request_user_input and the text above it outside the fold', () => {
  const layout = layoutAnswerProcessWithPlans([
    { type: 'thinking', text: 'hmm' },
    { type: 'text', text: '两个方案：最小改动 / 嵌套树' },
    {
      type: 'tools',
      cards: [{ id: 'q1', name: 'request_user_input', status: 'done' }],
    },
    { type: 'text', text: '好的，按最小改动做' },
  ]);
  assert.equal(layout.hasFold, true);
  assert.equal(layout.items[0].type, 'fold');
  assert.equal(layout.items[0].groups[0].type, 'thinking');
  assert.equal(layout.items[1].type, 'group');
  assert.equal(layout.items[1].group.type, 'text');
  assert.match(layout.items[1].group.text, /两个方案/);
  assert.equal(layout.items[2].type, 'group');
  assert.equal(layout.items[2].group.cards[0].name, 'request_user_input');
  assert.equal(layout.items[3].group.type, 'text');
  assert.match(layout.items[3].group.text, /最小改动做/);
});

test('layout hoists request_user_input out of a nested process fold', () => {
  const layout = layoutAnswerProcessWithPlans([
    { type: 'text', text: '请确认分类方案' },
    {
      type: 'process',
      groups: [
        { type: 'thinking', text: 'asking' },
        {
          type: 'tools',
          cards: [
            { id: 'r1', name: 'read', status: 'done' },
            { id: 'q1', name: 'request_user_input', status: 'done' },
          ],
        },
      ],
    },
    { type: 'text', text: 'done' },
  ]);

  assert.equal(layout.hasFold, true);
  const foldTools = layout.items
    .filter((item) => item.type === 'fold')
    .flatMap((item) => item.groups || [])
    .flatMap((group) => (group.type === 'process' ? group.groups : [group]))
    .filter((group) => group.type === 'tools')
    .flatMap((group) => group.cards || []);
  assert.equal(foldTools.some((card) => card.name === 'request_user_input'), false);
  assert.equal(foldTools.some((card) => card.name === 'read'), true);

  const visible = layout.items.filter((item) => item.type === 'group');
  assert.equal(visible[0].group.type, 'text');
  assert.match(visible[0].group.text, /分类方案/);
  assert.equal(visible[1].group.cards[0].name, 'request_user_input');
  assert.equal(visible[2].group.type, 'text');
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

test('layout does not fold while the turn is still in progress', () => {
  const layout = layoutAnswerProcessWithPlans(
    [
      { type: 'thinking', text: 'hmm' },
      { type: 'tools', cards: [{ id: 'r1', name: 'read', status: 'done' }] },
      { type: 'text', text: 'partial body' },
    ],
    null,
    { fold: false },
  );
  assert.equal(layout.hasFold, false);
  assert.equal(layout.items.every((item) => item.type === 'group'), true);
  assert.equal(layout.items[0].group.type, 'thinking');
  assert.equal(layout.items.at(-1).group.type, 'text');
});

test('layout keeps trailing tools after the last body instead of unfolding', () => {
  const layout = layoutAnswerProcessWithPlans([
    { type: 'thinking', text: 'hmm' },
    { type: 'tools', cards: [{ id: 'r1', name: 'read', status: 'done' }] },
    { type: 'text', text: 'here is the answer' },
    { type: 'thinking', text: 'more thought' },
    { type: 'tools', cards: [{ id: 'r2', name: 'read', status: 'running' }] },
  ]);
  assert.equal(layout.hasFold, true);
  assert.equal(layout.items[0].type, 'fold');
  assert.equal(
    layout.items[0].groups.some((group) => group.type === 'thinking'),
    true,
  );
  const visible = layout.items.filter((item) => item.type === 'group');
  assert.equal(visible[0].group.type, 'text');
  assert.match(visible[0].group.text, /answer/);
  assert.equal(visible[1].group.type, 'thinking');
  assert.equal(visible[2].group.cards[0].id, 'r2');
});

test('live layout reports a persistent task card even before a final answer exists', () => {
  const layout = layoutAnswerProcessWithPlans([
    { type: 'process', groups: [{ type: 'tools', cards: [
      { id: 'todo-1', name: 'tasks', arguments: { tasks: [{ content: 'Inspect', status: 'in_progress' }] } },
      { id: 'read-1', name: 'read', status: 'done' },
    ] }] },
  ]);

  assert.equal(layout.hasTodo, true);
  assert.equal(layout.items[0].group.type, 'process');
  assert.equal(layout.items[1].group.cards[0].name, 'tasks');
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
