import { trimInline as trimInlineText } from './string-utils.js';

export const TOOL_DISPLAY_LABELS = {
  create_plan: 'Create Plan',
  create_spec: 'Create Spec',
  update_todos: 'Update Todos',
  read_plan: 'Read Plan',
  update_plan: 'Update Plan',
  query_project_index: 'Query Project Index',
  tool_search: 'Tool Search',
  ast_query: 'AST Query',
  read_ast_node: 'Read AST Node',
  web_fetch: 'Web Fetch',
  web_search: 'Web Search',
  list_background_tasks: 'List Background Tasks',
  get_background_task: 'Get Background Task',
  stop_background_task: 'Stop Background Task',
  add_code_comment: 'Add Code Comment',
  update_code_comment: 'Update Code Comment',
  read: 'Read',
  edit: 'Edit',
  create: 'Create',
  delete: 'Delete',
  run: 'Run',
  grep: 'Search',
  glob: 'Glob',
  list: 'List',
  skill: 'Skill'
};

export function normalizeToolId(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
}

export function formatToolLabel(name) {
  const normalized = normalizeToolId(name);
  if (!normalized) return 'Tool';
  if (TOOL_DISPLAY_LABELS[normalized]) return TOOL_DISPLAY_LABELS[normalized];
  return normalized
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function formatToolDisplayName(name, args = {}) {
  const toolName = normalizeToolId(name);
  const trimInline = (value, max) => trimInlineText(value, max);

  if (toolName === 'grep') {
    const query = trimInline(args?.pattern || args?.query || args?.symbol || '', 96);
    return query ? `${formatToolLabel('grep')}("${query}")` : formatToolLabel('grep');
  }
  if (toolName === 'glob') {
    const pattern = trimInline(args?.pattern || '', 96);
    return pattern ? `${formatToolLabel('glob')}(${pattern})` : formatToolLabel('glob');
  }
  if (toolName === 'list') {
    const target = trimInline(args?.path || '.', 96) || '.';
    return `${formatToolLabel('list')}(${target})`;
  }
  if (toolName === 'read' || toolName === 'create') {
    const target = trimInline(args?.path || '.', 96) || '.';
    if (toolName === 'read') {
      const start = Number(args?.start_line);
      const end = Number(args?.end_line);
      const hasRange = Number.isFinite(start) && start > 0;
      const suffix = hasRange ? `:${start}-${Number.isFinite(end) && end >= start ? end : start}` : '';
      return `${formatToolLabel('read')}(${target}${suffix})`;
    }
    return `${formatToolLabel('create')}(${target})`;
  }
  if (toolName === 'run') {
    const command = trimInline(args?.command || '', 96);
    return command ? `${formatToolLabel('run')}(${command})` : formatToolLabel('run');
  }
  if (toolName === 'web_fetch') {
    const url = trimInline(args?.url || args?.href || '', 96);
    return url ? `${formatToolLabel('web_fetch')}(${url})` : formatToolLabel('web_fetch');
  }
  if (toolName === 'web_search') {
    const query = trimInline(args?.query || args?.q || '', 96);
    return query ? `${formatToolLabel('web_search')}(${query})` : formatToolLabel('web_search');
  }
  if (toolName === 'skill') {
    const target = trimInline(args?.name || args?.skill || args?.query || '', 96);
    return target ? `${formatToolLabel('skill')}(${target.replace(/^\/+/, '')})` : formatToolLabel('skill');
  }
  if (toolName === 'edit') {
    const target = trimInline(args?.path || args?.file || '.', 96) || '.';
    return `${formatToolLabel('edit')}(${target})`;
  }
  if (toolName === 'delete') {
    const target = trimInline(args?.path || args?.target || '.', 96) || '.';
    return `${formatToolLabel('delete')}(${target})`;
  }
  if (toolName === 'create_plan') {
    const goal = trimInline(args?.goal || '', 96);
    return goal ? `${formatToolLabel('create_plan')}(${goal})` : formatToolLabel('create_plan');
  }
  if (toolName === 'create_spec') {
    const topic = trimInline(args?.topic || '', 96);
    return topic ? `${formatToolLabel('create_spec')}(${topic})` : formatToolLabel('create_spec');
  }
  if (toolName === 'update_todos' || toolName === 'read_plan' || toolName === 'update_plan') {
    return formatToolLabel(toolName);
  }
  if (toolName === 'list_background_tasks') {
    return formatToolLabel('list_background_tasks');
  }
  if (toolName === 'get_background_task' || toolName === 'stop_background_task') {
    const taskId = trimInline(args?.task_id || args?.taskId || '', 96);
    const label = formatToolLabel(toolName);
    return taskId ? `${label}(${taskId})` : label;
  }
  if (toolName === 'query_project_index') {
    const query = trimInline(args?.query || '', 96);
    return query ? `${formatToolLabel('query_project_index')}(${query})` : formatToolLabel('query_project_index');
  }
  if (toolName === 'tool_search') {
    const query = trimInline(args?.query || args?.name || '', 96);
    return query ? `${formatToolLabel('tool_search')}(${query})` : formatToolLabel('tool_search');
  }
  return formatToolLabel(toolName);
}
