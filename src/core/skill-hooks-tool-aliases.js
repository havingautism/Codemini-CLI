/**
 * Claude Code tool names ↔ Codemini tool names.
 * Used so remote skill matchers like "Bash" still match Codemini's "run".
 */

export const CLAUDE_TO_CODEMINI = Object.freeze({
  Bash: 'run',
  bash: 'run',
  Shell: 'run',
  shell: 'run',
  Powershell: 'run',
  PowerShell: 'run',
  powershell: 'run',
  Read: 'read',
  Write: 'write',
  Edit: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Glob: 'glob',
  Grep: 'grep',
  Skill: 'skill',
  WebFetch: 'web_fetch',
  WebSearch: 'web_search',
  TodoWrite: 'update_todos',
  Agent: 'tool_search',
});

/** Codemini tools shown in matcher dropdowns (id → i18n key suffix). */
export const CODEMINI_HOOK_TOOLS = Object.freeze([
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
]);

const REVERSE = (() => {
  const map = new Map();
  for (const [claude, codemini] of Object.entries(CLAUDE_TO_CODEMINI)) {
    const list = map.get(codemini) || [];
    list.push(claude);
    map.set(codemini, list);
  }
  return map;
})();

export function canonicalToolName(name = '') {
  const raw = String(name || '').trim();
  if (!raw) return '';
  if (CLAUDE_TO_CODEMINI[raw]) return CLAUDE_TO_CODEMINI[raw];
  const lower = raw.toLowerCase();
  for (const [key, value] of Object.entries(CLAUDE_TO_CODEMINI)) {
    if (key.toLowerCase() === lower) return value;
  }
  return raw;
}

export function toolNameCandidates(toolName = '') {
  const raw = String(toolName || '').trim();
  if (!raw) return [];
  const canonical = canonicalToolName(raw);
  const aliases = REVERSE.get(canonical) || [];
  return [...new Set([raw, canonical, ...aliases])];
}

/**
 * Rewrite a Claude-style matcher to also accept Codemini names when the
 * matcher is a simple name or `|`-alternation (no complex regex metacharacters
 * beyond `|`). Complex patterns are left unchanged; runtime still tests
 * against toolNameCandidates.
 */
export function rewriteMatcherAliases(matcher = '') {
  const text = String(matcher || '').trim();
  if (!text) return text;
  if (!/^[A-Za-z0-9_|./:-]+$/.test(text)) return text;

  const parts = text.split('|').map((part) => part.trim()).filter(Boolean);
  const expanded = [];
  for (const part of parts) {
    const candidates = toolNameCandidates(part);
    for (const candidate of candidates) {
      if (!expanded.includes(candidate)) expanded.push(candidate);
    }
  }
  return expanded.join('|');
}
