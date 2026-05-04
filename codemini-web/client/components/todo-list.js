import { h } from '../utils/dom.js';

export function renderTodos(container, todos) {
  if (!todos || !todos.length) return;
  const list = h('div', { className: 'todo-list' });
  for (const todo of todos) {
    const status = todo.status === 'completed' ? 'done' : todo.status === 'in_progress' ? 'active' : '';
    const checkClass = `todo-check ${status}`.trim();
    const textClass = `todo-text ${status}`.trim();
    const icon = todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '●' : '';
    list.appendChild(h('div', { className: 'todo-item' },
      h('span', { className: checkClass }, icon),
      h('span', { className: textClass }, todo.content || todo.activeForm || '')
    ));
  }
  container.appendChild(list);
}
