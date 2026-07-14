/** Client-side copy of Codemini hook tool options (keep in sync with src/core/skill-hooks-tool-aliases.js). */
export const HOOK_TOOL_OPTIONS = [
  { id: 'run', labelKey: 'hookTool_run' },
  { id: 'read', labelKey: 'hookTool_read' },
  { id: 'write', labelKey: 'hookTool_write' },
  { id: 'edit', labelKey: 'hookTool_edit' },
  { id: 'apply_patch', labelKey: 'hookTool_apply_patch' },
  { id: 'delete', labelKey: 'hookTool_delete' },
  { id: 'grep', labelKey: 'hookTool_grep' },
  { id: 'glob', labelKey: 'hookTool_glob' },
  { id: 'list', labelKey: 'hookTool_list' },
  { id: 'search_code', labelKey: 'hookTool_search_code' },
  { id: 'query_project_index', labelKey: 'hookTool_query_project_index' },
  { id: 'skill', labelKey: 'hookTool_skill' },
  { id: 'web_fetch', labelKey: 'hookTool_web_fetch' },
  { id: 'web_search', labelKey: 'hookTool_web_search' },
  { id: 'update_todos', labelKey: 'hookTool_update_todos' },
  { id: 'update_plan', labelKey: 'hookTool_update_plan' },
];

export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
];

export function hookEventI18nKey(eventName) {
  return `hookEvent_${eventName}`;
}

export function emptyHooksState() {
  const state = { __rawHooks: {} };
  for (const event of HOOK_EVENTS) {
    state[event] = { checked: false, matcher: '', command: '', dirty: false, advanced: false };
  }
  return state;
}

export function hooksObjectToState(hooks = {}) {
  const state = emptyHooksState();
  state.__rawHooks = structuredClone(hooks && typeof hooks === 'object' ? hooks : {});
  for (const event of HOOK_EVENTS) {
    const groups = Array.isArray(hooks?.[event]) ? hooks[event] : [];
    const first = groups[0];
    const handlers = Array.isArray(first?.hooks) ? first.hooks : [];
    const handler = handlers.find((item) => !item?.type || item.type === 'command') || null;
    if (first || handler) {
      state[event] = {
        checked: true,
        matcher: first?.matcher ? String(first.matcher) : '',
        command: handler?.command ? String(handler.command) : '',
        dirty: false,
        advanced:
          groups.length > 1 ||
          handlers.length > 1 ||
          handlers.some((item) => item?.type && item.type !== 'command') ||
          Boolean(handler?.timeout !== undefined || handler?.failClosed !== undefined),
      };
    }
  }
  return state;
}

export function hooksStateToObject(hooksState = {}) {
  const raw = hooksState.__rawHooks && typeof hooksState.__rawHooks === 'object'
    ? hooksState.__rawHooks
    : {};
  const out = structuredClone(raw);
  for (const event of HOOK_EVENTS) {
    const entry = hooksState[event];
    if (!entry?.dirty) continue;
    if (!entry.checked) {
      delete out[event];
      continue;
    }
    if (!entry?.checked) continue;
    const command = String(entry.command || '').trim();
    if (!command) continue;
    const groups = Array.isArray(out[event]) ? structuredClone(out[event]) : [];
    const first = groups[0] && typeof groups[0] === 'object' ? groups[0] : { hooks: [] };
    const handlers = Array.isArray(first.hooks) ? first.hooks : [];
    const commandIndex = handlers.findIndex((item) => !item?.type || item.type === 'command');
    if (commandIndex >= 0) {
      handlers[commandIndex] = { ...handlers[commandIndex], type: 'command', command };
    } else {
      handlers.unshift({ type: 'command', command });
    }
    if (entry.matcher) first.matcher = String(entry.matcher).trim();
    else delete first.matcher;
    first.hooks = handlers;
    if (groups.length > 0) groups[0] = first;
    else groups.push(first);
    out[event] = groups;
  }
  return out;
}

export function hooksStateIsDirty(hooksState = {}) {
  return HOOK_EVENTS.some((event) => hooksState[event]?.dirty === true);
}

export function hooksStateHasInvalidCommand(hooksState = {}) {
  return HOOK_EVENTS.some((event) => {
    const entry = hooksState[event];
    return entry?.checked && entry?.dirty && !String(entry.command || '').trim();
  });
}
