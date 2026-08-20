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
