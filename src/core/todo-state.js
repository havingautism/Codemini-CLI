export function normalizeTodoStatus(value) {
  const status = String(value || 'pending').trim().toLowerCase();
  return ['pending', 'in_progress', 'completed'].includes(status) ? status : 'pending';
}

export function normalizeTodos(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      content: String(item?.content || '').trim(),
      activeForm: String(item?.activeForm || '').trim(),
      status: normalizeTodoStatus(item?.status)
    }))
    .filter((item) => item.content);
}

export function countTodosByStatus(todos) {
  const items = normalizeTodos(todos);
  return {
    pending: items.filter((item) => item.status === 'pending').length,
    inProgress: items.filter((item) => item.status === 'in_progress').length,
    completed: items.filter((item) => item.status === 'completed').length,
    total: items.length
  };
}

export function countActiveTodos(todos) {
  const counts = countTodosByStatus(todos);
  return counts.total - counts.completed;
}

const TODO_TOOL_NAMES = new Set(['tasks', 'update_todos']);

export function isTodoToolName(name) {
  return TODO_TOOL_NAMES.has(String(name || '').toLowerCase().replace(/\(.*$/, ''));
}

export function settleTodosCompleted(value) {
  return normalizeTodos(value).map((item) => (
    item.status === 'completed' ? item : { ...item, status: 'completed' }
  ));
}

function settleTodoListField(target, key) {
  if (!target || !Array.isArray(target[key])) return target;
  return { ...target, [key]: settleTodosCompleted(target[key]) };
}

export function settleTodoToolCard(card) {
  if (!card || !isTodoToolName(card.name)) return card;
  let next = card;
  if (next.arguments && typeof next.arguments === 'object') {
    const args = settleTodoListField(settleTodoListField(next.arguments, 'tasks'), 'todos');
    if (args !== next.arguments) next = { ...next, arguments: args };
  }
  if (next.result && typeof next.result === 'object') {
    let result = next.result;
    result = settleTodoListField(result, 'newTodos');
    result = settleTodoListField(result, 'tasks');
    result = settleTodoListField(result, 'todos');
    if (result !== next.result) next = { ...next, result };
  }
  return next;
}

export function settleTodoCardsInSegments(segments) {
  if (!Array.isArray(segments)) return segments;
  return segments.map((segment) => {
    if (segment?.type === 'process' && Array.isArray(segment.groups)) {
      return { ...segment, groups: settleTodoCardsInSegments(segment.groups) };
    }
    if (segment?.type !== 'tools' || !Array.isArray(segment.cards)) return segment;
    return {
      ...segment,
      cards: segment.cards.map((card) => settleTodoToolCard(card)),
    };
  });
}

export function canonicalizeTodos(value) {
  const todos = [];
  const seen = new Set();
  for (const item of Array.isArray(value) ? value : []) {
    const content = String(item?.content || '').trim();
    if (!content) {
      return { error: 'invalid todo: `content` must be a non-empty string' };
    }
    if (seen.has(content)) {
      return { error: `invalid todos: duplicate content ${JSON.stringify(content)}` };
    }
    seen.add(content);
    todos.push({
      content,
      activeForm: String(item?.activeForm || '').trim(),
      status: normalizeTodoStatus(item?.status)
    });
  }
  return { todos };
}
