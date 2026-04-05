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
    .filter((item) => item.content && item.activeForm);
}

export function countActiveTodos(todos) {
  return normalizeTodos(todos).filter((item) => item.status !== 'completed').length;
}
