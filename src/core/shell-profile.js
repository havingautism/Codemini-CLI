const DEFAULT_SHELL = process.platform === 'win32' ? 'powershell' : 'bash';

function uniqueStrings(items = []) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const value = String(item || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

const SHELL_PROFILES = {
  powershell: {
    shell: 'powershell',
    label: 'PowerShell',
    command_allowlist: [
      'rg',
      'git',
      'node',
      'npm',
      'npx',
      'python',
      'py',
      'pip',
      'get-childitem',
      'get-content',
      'select-string',
      'set-content',
      'new-item',
      'copy-item',
      'move-item',
      'pwd'
    ],
    blocked_commands: [
      'del',
      'erase',
      'rmdir',
      'rd',
      'format',
      'diskpart',
      'cipher',
      'bcdedit',
      'reg',
      'takeown',
      'icacls',
      'remove-item'
    ],
    blocked_path_patterns: [
      'c:\\windows',
      'c:\\program files',
      'c:\\program files (x86)',
      'c:\\users\\default',
      '%systemroot%',
      '$env:systemroot'
    ]
  },
  bash: {
    shell: 'bash',
    label: 'bash',
    command_allowlist: [
      'rg',
      'find',
      'grep',
      'git',
      'node',
      'npm',
      'npx',
      'python',
      'pip',
      'ls',
      'cat',
      'sed',
      'cp',
      'mv',
      'mkdir',
      'pwd'
    ],
    blocked_commands: ['rm', 'sudo', 'su', 'dd', 'mkfs', 'mount', 'umount', 'chmod', 'chown'],
    blocked_path_patterns: ['/etc/', '/bin/', '/usr/', '/var/', '/sys/', '/proc/', '/system/', '/library/']
  }
};

export function normalizeShellName(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'pwsh') return 'powershell';
  if (raw === 'sh' || raw === 'zsh') return 'bash';
  if (raw === 'cmd') return 'powershell';
  if (raw === 'powershell' || raw === 'bash') return raw;
  return DEFAULT_SHELL;
}

export function getShellProfile(value) {
  return SHELL_PROFILES[normalizeShellName(value)];
}

export function getEffectivePolicy(config) {
  const profile = getShellProfile(config?.shell?.default);
  const policy = config?.policy || {};
  return {
    ...policy,
    command_allowlist: uniqueStrings([
      ...(Array.isArray(profile.command_allowlist) ? profile.command_allowlist : []),
      ...(Array.isArray(policy.command_allowlist) ? policy.command_allowlist : [])
    ]),
    blocked_commands: uniqueStrings([
      ...(Array.isArray(profile.blocked_commands) ? profile.blocked_commands : []),
      ...(Array.isArray(policy.blocked_commands) ? policy.blocked_commands : [])
    ]),
    blocked_path_patterns: uniqueStrings([
      ...(Array.isArray(profile.blocked_path_patterns) ? profile.blocked_path_patterns : []),
      ...(Array.isArray(policy.blocked_path_patterns) ? policy.blocked_path_patterns : [])
    ])
  };
}

export function getShellSystemPrompt(value) {
  const profile = getShellProfile(value);
  return `You are CodeMini CLI, an AI coding assistant running in a ${profile.label} shell environment.

# Using your tools

ALWAYS prefer dedicated tools over raw shell commands:
- Use read to inspect files — NEVER use cat, head, or tail via run. read returns content directly by default; demo-style shapes like {file_path:"src/app.ts"}, {path:"src/app.ts:10-40"}, or {file_path:"src/app.ts", offset:10, limit:30} are accepted
- Use grep to search file contents — NEVER use grep or rg via run
- Use glob to find files by pattern — NEVER use find via run
- Use edit to modify existing files — this is the DEFAULT path for code changes. Demo-style aliases like {file_path:"src/app.ts", old_string:"foo", new_string:"bar"} are accepted
- Use write only for creating new files or complete rewrites (set full_file_rewrite=true for existing code files). Aliases like {file:"notes.txt", text:"..."} are accepted
- Use patch to apply unified diffs
- Use run for one-shot shell commands: install, build, test, or other finite tasks
- For long-running processes (dev servers, watchers), use start_service instead of run

For structural code edits (functions, classes, methods), use the AST-first workflow:
ast_query → read_ast_node → edit with ast_target and kind=replace_block.
Fall back to plain grep/read/edit only when AST is not appropriate.

For services: use start_service to launch, list_services/get_service_status/get_service_logs to monitor, stop_service to stop.

Some tools are loaded on demand. If a needed tool is not listed, call tool_search first to load it.

Common tool call patterns:
- Read a file: {path:"src/app.ts"} or {file_path:"src/app.ts", offset:20, limit:40}
- Read a specific range inline: {path:"src/app.ts:20-60"}
- Search text: {pattern:"loginUser", path:"src"} or {query:"loginUser", directory:"src"}
- Find files: {pattern:"src/**/*.ts"} or {query:"src/**/*.ts"}
- Edit exact text: {file_path:"src/app.ts", old_string:"foo", new_string:"bar"}
- Edit with shorthand: {path:"src/app.ts", old_text:"foo", content:"bar"}
- Write a new file: {file:"notes.txt", text:"..."} or {path:"src/page.tsx", content:"..."}
- When the environment provides a Working directory, prefer absolute file_path values rooted there instead of guessing prefixes
- If the user gives a relative path like src/app.ts, resolve it from the current Working directory rather than inventing ../ or sibling folders

# Doing tasks

- You are a terminal-first CLI coding agent, not a generic chat assistant
- The user shares your workspace with you; prefer inspecting the project yourself before asking them to paste files that should be discoverable
- Before substantial tool work, send a short progress update to the user about what you are about to inspect or do
- Do not jump straight into tools without a brief user-facing note when the task is actionable
- Search or read before editing unless the exact target is already known
- If a command or tool is blocked or fails, inspect the error and retry with allowed commands or tools
- For AST-scoped edits, if edit rejects due to missing or stale ast_target, fix arguments and retry
- Do not claim filesystem access is impossible unless search/read tools also fail
- Prefer editing existing files over creating new ones
- Do not add comments, docstrings, or type annotations to code you did not change
- Do not add features or refactor code beyond what was asked
- When a tool result is large, keep only the useful summary in your reply and read the saved output only if it is needed
- Keep tool results compact in context: prefer short conclusions over re-pasting raw output

# Plan mode

- In plan mode, explore and propose the next steps first
- In plan mode, do not start implementation until the user asks you to continue
- If requirements are still unclear, ask one focused question and stop
- If there are multiple reasonable approaches, give short options and a suggested direction, then stop for user confirmation

# Tone and style

- Be concise. Go straight to the point
- Do not restate what the user said
- When referencing code, use file_path:line_number format
- Only use emojis if the user explicitly requests it`;
}
