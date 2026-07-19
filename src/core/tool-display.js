import { trimInline as trimInlineText } from './string-utils.js';

export const TOOL_DISPLAY_LABELS = {
  create_plan: 'Plan',
  create_spec: 'Create Spec',
  update_todos: 'Update Todos',
  read_plan: 'Read Plan',
  update_plan: 'Update Plan',
  search_code: 'Search Code',
  query_project_index: 'Query Project Index',
  tool_search: 'Tool Search',
  ast_grep: 'AST Grep',
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
  write: 'Write',
  begin_write: 'Begin Write',
  write_chunk: 'Write Chunk',
  commit_write: 'Commit Write',
  abort_write: 'Abort Write',
  apply_patch: 'Apply Patch',
  delete: 'Delete',
  run: 'Run',
  grep: 'Search',
  glob: 'Glob',
  list: 'List',
  skill: 'Skill'
};

/** @type {Map<string, string>} MCP tool function name → UI label (browser-safe registry) */
const mcpToolDisplayLabels = new Map();

export function setMcpToolDisplayLabels(entries = {}) {
  mcpToolDisplayLabels.clear();
  for (const [name, label] of Object.entries(entries || {})) {
    const key = String(name || '').trim();
    const value = String(label || '').trim();
    if (key && value) mcpToolDisplayLabels.set(key, value);
  }
}

export function resolveMcpToolDisplayLabel(toolName) {
  const raw = String(toolName || '').trim();
  if (!raw) return '';
  if (mcpToolDisplayLabels.has(raw)) return mcpToolDisplayLabels.get(raw);
  const normalized = raw.toLowerCase();
  if (mcpToolDisplayLabels.has(normalized)) return mcpToolDisplayLabels.get(normalized);
  return '';
}

export function normalizeToolId(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
}

function fallbackMcpToolLabel(name) {
  const raw = String(name || '').trim();
  const registered = resolveMcpToolDisplayLabel(raw);
  if (registered) return registered;
  const match = raw.match(/^mcp__([a-z0-9_-]+?)__([a-z0-9_-]+?)(?:_\d+)?$/i);
  if (!match) return '';
  return `MCP/${match[1]} · ${match[2]}`;
}

export function formatToolLabel(name, options = {}) {
  const raw = String(name || '').trim();
  const overrides = options.displayLabels && typeof options.displayLabels === 'object'
    ? options.displayLabels
    : null;
  if (overrides?.[raw]) return String(overrides[raw]);
  const normalized = normalizeToolId(name);
  if (overrides?.[normalized]) return String(overrides[normalized]);
  if (!normalized) return 'Tool';
  if (TOOL_DISPLAY_LABELS[normalized]) return TOOL_DISPLAY_LABELS[normalized];
  const mcpLabel = fallbackMcpToolLabel(raw) || fallbackMcpToolLabel(normalized);
  if (mcpLabel) return mcpLabel;
  return normalized
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function parseToolDisplayName(name) {
  const raw = String(name || '').trim();
  const match = raw.match(/^([^(]+?)\s*\((.*)\)$/s);
  return {
    raw,
    label: (match ? match[1] : raw).trim(),
    arg: match ? match[2] : ''
  };
}

function formatToolWithArg(label, arg, { quoted = false } = {}) {
  const payload = String(arg || '').trim();
  if (!payload) return label;
  return `${label} (${quoted ? `"${payload}"` : payload})`;
}

function appendPrimaryToolArg(label, args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return label;
  const trimInline = (value, max) => trimInlineText(value, max);
  for (const key of ['url', 'query', 'path', 'command', 'pattern', 'name']) {
    const value = trimInline(args[key], 96);
    if (!value) continue;
    const quoted = key === 'query' || key === 'pattern';
    return formatToolWithArg(label, value, { quoted });
  }
  for (const value of Object.values(args)) {
    if (typeof value !== 'string') continue;
    const trimmed = trimInline(value, 96);
    if (trimmed) return formatToolWithArg(label, trimmed);
  }
  return label;
}

export function formatToolDisplayName(name, args = {}, options = {}) {
  const rawName = String(name || '').trim();
  const toolName = normalizeToolId(name);
  const trimInline = (value, max) => trimInlineText(value, max);
  const overrideLabel = options?.displayLabels?.[rawName]
    || options?.displayLabels?.[toolName]
    || '';
  if (overrideLabel || fallbackMcpToolLabel(rawName) || fallbackMcpToolLabel(toolName)) {
    return appendPrimaryToolArg(
      overrideLabel || formatToolLabel(rawName, options),
      args,
    );
  }

  if (toolName === 'grep') {
    const query = trimInline(args?.pattern || args?.query || args?.symbol || '', 96);
    return query ? formatToolWithArg(formatToolLabel('grep'), query, { quoted: true }) : formatToolLabel('grep');
  }
  if (toolName === 'search_code') {
    const query = trimInline(args?.query || args?.q || args?.pattern || '', 96);
    return query ? formatToolWithArg(formatToolLabel('search_code'), query, { quoted: true }) : formatToolLabel('search_code');
  }
  if (toolName === 'ast_grep') {
    const query = trimInline(args?.pattern || args?.query || '', 96);
    return query ? formatToolWithArg(formatToolLabel('ast_grep'), query, { quoted: true }) : formatToolLabel('ast_grep');
  }
  if (toolName === 'glob') {
    const pattern = trimInline(args?.pattern || '', 96);
    return pattern ? formatToolWithArg(formatToolLabel('glob'), pattern) : formatToolLabel('glob');
  }
  if (toolName === 'list') {
    const target = trimInline(args?.path || '.', 96) || '.';
    return formatToolWithArg(formatToolLabel('list'), target);
  }
  if (toolName === 'read' || toolName === 'create' || toolName === 'write' || toolName === 'begin_write') {
    const target = trimInline(args?.path || '.', 96) || '.';
    if (toolName === 'read') {
      const start = Number(args?.start_line);
      const end = Number(args?.end_line);
      const hasRange = Number.isFinite(start) && start > 0;
      const suffix = hasRange ? `:${start}-${Number.isFinite(end) && end >= start ? end : start}` : '';
      return formatToolWithArg(formatToolLabel('read'), `${target}${suffix}`);
    }
    return formatToolWithArg(formatToolLabel(toolName), target);
  }
  if (toolName === 'write_chunk') {
    const writeId = trimInline(args?.write_id || '', 48);
    const sequence = Number(args?.sequence);
    const suffix = Number.isSafeInteger(sequence) ? ` #${sequence}` : '';
    return writeId
      ? formatToolWithArg(formatToolLabel('write_chunk'), `${writeId}${suffix}`)
      : formatToolLabel('write_chunk');
  }
  if (toolName === 'commit_write' || toolName === 'abort_write') {
    const target = toolName === 'commit_write'
      ? trimInline(args?.path || args?.write_id || '', 96)
      : trimInline(args?.write_id || '', 64);
    return target
      ? formatToolWithArg(formatToolLabel(toolName), target)
      : formatToolLabel(toolName);
  }
  if (toolName === 'run') {
    const command = trimInline(args?.command || '', 96);
    return command ? formatToolWithArg(formatToolLabel('run'), command) : formatToolLabel('run');
  }
  if (toolName === 'web_fetch') {
    const url = trimInline(args?.url || args?.href || '', 96);
    return url ? formatToolWithArg(formatToolLabel('web_fetch'), url) : formatToolLabel('web_fetch');
  }
  if (toolName === 'web_search') {
    const query = trimInline(args?.query || args?.q || '', 96);
    return query ? formatToolWithArg(formatToolLabel('web_search'), query) : formatToolLabel('web_search');
  }
  if (toolName === 'skill') {
    const name = trimInline(args?.name || args?.skill || '', 96);
    const query = trimInline(args?.query || '', 96);
    if (query && !name) return formatToolWithArg(formatToolLabel('skill'), query);
    if (name) return formatToolWithArg(formatToolLabel('skill'), name);
    return formatToolLabel('skill');
  }
  if (toolName === 'edit') {
    const target = trimInline(args?.path || '.', 96) || '.';
    return formatToolWithArg(formatToolLabel('edit'), target);
  }
  if (toolName === 'delete') {
    const target = trimInline(args?.path || args?.target || '.', 96) || '.';
    return formatToolWithArg(formatToolLabel('delete'), target);
  }
  if (toolName === 'apply_patch') {
    const patchText = String(args?.patch_text || '');
    const fileMatches = [...patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)]
      .map((match) => trimInline(match[1], 48))
      .filter(Boolean);
    const label = formatToolLabel('apply_patch');
    if (fileMatches.length === 0) return label;
    const target = fileMatches.length === 1
      ? fileMatches[0]
      : `${fileMatches[0]} +${fileMatches.length - 1}`;
    return formatToolWithArg(label, target);
  }
  if (toolName === 'create_plan') {
    const goal = trimInline(args?.goal || '', 96);
    const label = 'Plan · 规划/执行';
    return goal ? formatToolWithArg(label, goal) : label;
  }
  if (toolName === 'create_spec') {
    const topic = trimInline(args?.topic || '', 96);
    return topic ? formatToolWithArg(formatToolLabel('create_spec'), topic) : formatToolLabel('create_spec');
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
    return taskId ? formatToolWithArg(label, taskId) : label;
  }
  if (toolName === 'query_project_index') {
    const query = trimInline(args?.query || '', 96);
    return query ? formatToolWithArg(formatToolLabel('query_project_index'), query) : formatToolLabel('query_project_index');
  }
  if (toolName === 'tool_search') {
    const query = trimInline(args?.query || args?.name || '', 96);
    return query ? formatToolWithArg(formatToolLabel('tool_search'), query) : formatToolLabel('tool_search');
  }
  return formatToolLabel(toolName, options);
}
