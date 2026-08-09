import path from 'node:path';
import { getSearchToolHint, resolveSearchToolContext } from './provider/search-tool-registry.js';
import { getReadOnlyCommandTokens } from './read-only-command-tokens.js';
import { shellToolName } from './shell-tool-name.js';

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
      'cd',
      'git',
      'node',
      'npm',
      'npx',
      'python',
      'python3',
      'py',
      'pip',
      'pip3',
      'get-childitem',
      'get-content',
      'get-location',
      'get-command',
      'get-help',
      'get-item',
      'get-process',
      'type',
      'select-string',
      'select-object',
      'select',
      'where-object',
      'foreach-object',
      'measure-object',
      'sort-object',
      'compare-object',
      'resolve-path',
      'split-path',
      'test-path',
      'write-host',
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
      'cd',
      'rg',
      'find',
      'grep',
      'git',
      'node',
      'npm',
      'npx',
      'python',
      'python3',
      'pip',
      'pip3',
      'ls',
      'cat',
      'sed',
      'head',
      'tail',
      'wc',
      'test',
      'sort',
      'uniq',
      'cut',
      'tr',
      'xargs',
      'basename',
      'dirname',
      'paste',
      'echo',
      'sleep',
      'true',
      'false',
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
      ...(profile.shell === 'bash' ? getReadOnlyCommandTokens() : []),
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
  const commandToolName = shellToolName({
    platform: profile.shell === 'powershell' ? 'win32' : 'linux',
    shell: profile.shell,
  });
  const psGuide = profile.shell === 'powershell'
    ? `
# PowerShell coding guidelines

When writing PowerShell commands or scripts, follow these rules:
- Encoding: Always use \`-Encoding utf8\` on file I/O — critical for PowerShell 5.1, recommended for 7+
- Paths: Use \`Join-Path\` instead of string concatenation (\`$folder + "\\" + $name\`)
- Safety: Prefix destructive commands (delete/stop/modify) with \`-WhatIf\` by default; provide a flag to bypass
- Objects: Prefer \`Where-Object\`, \`Select-Object\`, \`ForEach-Object\`, \`ConvertFrom-Json\` over string parsing
- Errors: When a command fails, inspect \`$error[0].Exception\` rather than guessing — check \`$_.Exception.GetType().FullName\` to categorize (e.g. UnauthorizedAccessException vs FileNotFoundException)
- Scripts vs interactive: Use full Verb-Noun names in .ps1 scripts; common aliases (\`ls\`, \`cat\`, \`rm\`) are acceptable in interactive shell sessions
- Critical operations: Wrap in \`try/catch\` with \`-ErrorAction Stop\`
- Structured output: Use \`[PSCustomObject]\` + \`ConvertTo-Json\` for data exchange between commands
`
    : `\n# Bash coding guidelines\n\nWhen writing bash commands or scripts, follow these rules:\n- Quoting: Always double-quote variable expansions ("$var") to prevent word splitting and globbing. Use single quotes for literal strings\n- Safety: Use \`set -euo pipefail\` at the top of scripts — \`-e\` exits on error, \`-u\` rejects unset variables, \`-o pipefail\` propagates pipe failures\n- Paths: Always wrap paths in double quotes. Use \`--\` to separate options from arguments when paths may start with \`-\`\n- Filenames: Prefer \`while IFS= read -r\` over \`for\` loops when processing file lists; \`find ... -print0 | xargs -0\` for robust handling of spaces and special characters\n- Errors: Check exit codes with \`$?\` or \`||\` chains. Use \`trap\` for cleanup on script exit\n- Portability: Prefer POSIX-compatible syntax (\`=\` not \`==\` in \`[ ]\`) unless bash-specific features (\`[[ ]]\`, arrays, \`<<<\`) are explicitly needed\n- Interactive vs scripts: Common aliases (\`ll\`, \`la\`) and shortcuts are acceptable in interactive sessions; use full commands in scripts\n- Structured output: Use \`jq\` for JSON processing, \`cut\`/\`awk\` for delimited text, and \`column -t\` for readable tables\n`;

  return `You are Codemini CLI, an AI assistant running in a ${profile.label} shell environment.${psGuide}

# Using your tools

ALWAYS prefer dedicated tools over raw shell commands:
- The visible default tool list is intentionally small. If a needed capability is not currently listed, do not assume it is unavailable — call tool_search to load additional tools first
- Treat ${commandToolName} as an execution tool, not a code-reading or code-search tool. Do not use ${commandToolName} to inspect source files, list code directories, grep identifiers, or print file contents when read/search_code/list/glob can do it
- Use search_code first for code discovery. It routes text, symbol, and structural searches internally so you can narrow candidates before reading source files
- Use read to inspect files — NEVER use cat, head, or tail via ${commandToolName}. Use canonical shapes like {path:"src/app.ts"}, {path:"src/app.ts:10-40"}, or {path:"src/app.ts", start_line:10, end_line:40}
- Do not use grep, rg, find, ls, Get-ChildItem, Select-String, Get-Content, or type via ${commandToolName} for normal code exploration. Use search_code/read first; load low-level grep/list/glob with tool_search only when that specific structured tool output is needed
- If you need directory listing or pattern-based file lookup, load list or glob with tool_search instead of falling back to ${commandToolName}
- Use edit to modify existing files — this is the DEFAULT path for code changes. Prefer {path:"src/app.ts", old_text:"foo", new_text:"bar"}
- Use edit for existing files, including complete rewrites with {path:"src/app.ts", new_content:"..."} or {path:"src/app.ts", kind:"rewrite_file", new_content:"..."}
- Use write for new files and whole-file output: new files use {path:"src/new.ts", content:"..."}; intentional overwrite uses {path:"src/app.ts", content:"...", overwrite:true}
- Use apply_patch for large or multi-file changes using a single patch_text string in the *** Begin Patch / *** End Patch format
- Tool arguments must be valid JSON objects. Escape file-content newlines as \\n inside JSON strings; never emit raw line breaks inside quoted JSON strings
- Use update_todos to manage the session todo checklist for complex work. Provide the full current list each time and usually keep exactly one item in_progress
- Use read_plan and update_plan to recover or sync structured plan state when plan progress was interrupted (for example by transient gateway/model errors)
- Use ${commandToolName} for shell commands. For long-running processes (dev servers, watchers), set run_in_background=true when you know you do not need the final result immediately. Long-running commands may also be backgrounded automatically

Use update_todos with these rules:
- MUST use it before major tool work when the task has 3 or more meaningful steps, multiple files or phases, explicit verification work, debugging with multiple hypotheses, or any non-trivial implementation likely to span several tool calls
- Do NOT use it for single-step trivial edits, one-off command execution, or purely informational/chat responses
- The input must be the full current checklist, not a partial patch
- Keep exactly one item in_progress while work is actively underway unless the user explicitly asks for parallel execution
- Mark items completed immediately after finishing them, and add newly discovered follow-up work as new checklist items
- If tests fail, verification is incomplete, or a blocker remains, do not mark the affected item completed
- Before giving a completion-style final answer for a complex task, update_todos so the checklist is either fully completed or clearly shows the remaining blocker

Some tools are loaded on demand through tool_search. Common examples:
- skill for activating an indexed skill by name
- grep, ast_grep, query_project_index, list, and glob for low-level search/discovery when search_code is not enough
- ast_query and read_ast_node for advanced Tree-sitter query workflows
- list_background_tasks, get_background_task, and stop_background_task for managing long-running background commands
- save_memory, list_memory, search_memory, and forget_memory for persistent memory operations

For structural code edits, narrow the target with search_code and read before editing; reuse a returned ast_target when available. Load lower-level AST tools only when ordinary search is insufficient.

For background commands, use ${commandToolName} with run_in_background=true and load management tools only when needed.

Resolve relative paths from the current Working directory; prefer absolute paths when the environment provides it.

# Doing tasks

- The user shares your workspace with you; prefer inspecting the project yourself before asking them to paste files that should be discoverable
- Before substantial tool work, send one short user-facing progress update
- If a command or tool is blocked or fails, inspect the error and retry with allowed commands or tools
- If the user rejects or declines a ${commandToolName} command (especially tests, builds, installs, or dev servers), treat verification as intentionally skipped. Do not retry the same or similar command unless the user asks again. Summarize completed code changes and note that verification was deferred
- For AST-scoped edits, if edit rejects due to missing or stale ast_target, fix arguments and retry
- Do not claim filesystem access is impossible unless search/read tools also fail
- Do not add comments, docstrings, or type annotations to code you did not change
- Do not add features or refactor code beyond what was asked

# Tone and style

- Keep answers compact and easy to scan
- Lead with the answer or next action, not scene-setting
- Do not restate the user's request unless a brief restatement prevents ambiguity
- When referencing code, use path:line_number format
- Keep technical wording, commands, paths, and error details exact
- Only use emojis if the user explicitly requests it`;
}

const SUB_AGENT_TOOL_HINTS = {
  read: '- read: inspect files. Example: {path:"src/app.ts"} or {path:"src/app.ts", start_line:10, end_line:40}',
  read_plan: '- read_plan: recover structured plan state when plan progress was interrupted',
  update_plan: '- update_plan: sync structured plan state during execution',
  tool_search: '- tool_search: load a deferred tool that is in your allowed list. Example: {query:"glob"} or {query:"ast_query"}',
  skill: '- skill: search/load user-installed or project skills. Browse with {name:"list"} and search with {query:"ts generic"}. Do not grep/list skills directories.',
  update_todos: '- update_todos: maintain the session todo checklist; send the full current list each time',
  search_code: '- search_code: default code search. Routes text, symbol, and structure search; follow results with read on the returned file/range or ast_target. Example: {query:"loginUser", mode:"auto", path:"src"}',
  query_project_index: '- query_project_index: low-level indexed symbol search; prefer search_code({mode:"symbol"}) unless raw index details are needed',
  grep: '- grep: low-level plain text search; prefer search_code({mode:"text"}) unless raw grep output is needed',
  ast_grep: '- ast_grep: low-level structural search; prefer search_code({mode:"structure"}) unless debugging ast-grep patterns',
  list: '- list: directory-by-directory filesystem discovery. Example: {path:"src"}',
  glob: '- glob: pattern-based file lookup (load with tool_search if not visible). Example: {pattern:"src/**/*.ts"}',
  ast_query: '- ast_query: AST-scoped symbol lookup (load with tool_search if not visible)',
  read_ast_node: '- read_ast_node: read AST node details for structural edits',
  edit: '- edit: modify existing files. Exact replace: {path:"src/app.ts", old_text:"foo", new_text:"bar"}. Full rewrite: {path:"src/app.ts", new_content:"...\\n"}. Tool JSON strings must escape newlines as \\n',
  write: '- write: write a complete file. New file: {path:"src/new.ts", content:"...\\n"}. Existing file overwrite requires {path:"src/app.ts", content:"...\\n", overwrite:true}',
  apply_patch: '- apply_patch: apply large or multi-file patches with one patch_text string using *** Begin Patch / *** End Patch. Escape newlines as \\n inside JSON strings',
  delete: '- delete: remove files',
  run: '- run: execute shell commands when no dedicated tool fits. Do not use run for code reading/search; use search_code/read/list/glob instead.',
  web_fetch: '- web_fetch: fetch remote URL content',
  web_search: '- web_search: search the web for external information'
};

export function buildSubAgentShellRulesPrompt(allowedTools = [], { shell, workspaceRoot = process.cwd(), role = '', config = {} } = {}) {
  const profile = getShellProfile(shell);
  const allowed = uniqueStrings(Array.isArray(allowedTools) ? allowedTools : []);
  const commandToolName = shellToolName({
    platform: String(shell || '').toLowerCase() === 'powershell' ? 'win32' : 'linux',
    shell,
  });
  const searchCtx = resolveSearchToolContext(config);
  const toolList = allowed.map((name) => name === 'run' ? commandToolName : name).join(', ') || 'none';
  const hintLines = allowed
    .map((name) => {
      if (name === 'run' && ['coder', 'refactorer', 'writer'].includes(role)) {
        return `- ${commandToolName}: only for commands required to complete the edit itself (for example code generation). Do not use ${commandToolName} for tests, builds, installs, or dev servers unless the step task explicitly requires it`;
      }
      if (searchCtx.toolId && name === searchCtx.toolId) {
        return getSearchToolHint(config);
      }
      return name === 'run'
        ? SUB_AGENT_TOOL_HINTS.run.replaceAll('run', commandToolName)
        : SUB_AGENT_TOOL_HINTS[name];
    })
    .filter(Boolean);
  const deferredTools = allowed.filter((name) => !['read', 'search_code', 'read_plan', 'update_plan', 'update_todos', 'edit', 'write', 'begin_write', 'write_chunk', 'commit_write', 'abort_write', 'apply_patch', 'delete', 'run', 'tool_search', 'skill'].includes(name));
  const lines = [
    `You are Codemini CLI, an AI assistant running as a pipeline sub-agent in a ${profile.label} shell environment.`,
    `Working directory: ${path.resolve(workspaceRoot || process.cwd())}`,
    '',
    '# Tool scope (strict)',
    `You may ONLY call these tools: ${toolList}`,
    `Calling any other tool fails immediately. Parent-agent tools such as list, grep, ${commandToolName}, or edit are NOT available unless they appear in the list above.`,
    `Do not use raw shell commands via ${commandToolName} unless ${commandToolName} is in your allowed tool list.`,
    `Even when ${commandToolName} is allowed, do not use it to read source files, list code directories, or search identifiers. Use read/search_code/list/glob-style tools for code context; reserve ${commandToolName} for execution such as tests, builds, scripts, package commands, and servers.`,
    '',
    '# Using your allowed tools',
    ...(hintLines.length > 0 ? hintLines : ['- No dedicated tools beyond the list above.']),
    ...(deferredTools.length > 0
      ? ['', 'Some allowed tools load on demand through tool_search:', ...deferredTools.map((name) => `- ${name}`)]
      : []),
    '',
    '# Doing tasks',
    '- Prefer the handoff packets and plan file context already included in your task before making tool calls',
    '- Send a brief progress note before substantial tool work when the task is actionable',
    '- If a tool call fails because it is unavailable, stop retrying it and continue with allowed tools or the provided context',
    '- Finish with the structured headings requested by your role prompt. For every non-final role, include a Handoff section that states exactly what downstream steps should use',
    '- Keep answers compact and easy to scan',
    '- When referencing code, use path:line_number format'
  ];
  if (['coder', 'refactorer', 'writer'].includes(role)) {
    lines.push('- Your step owns implementation changes, not runtime verification. Leave tests/builds/dev servers to the tester step or the user unless this step task explicitly requires a command to finish the edit');
    lines.push(`- When edits are done, finish with the structured handoff. Set Verified to none or deferred instead of trying to prove behavior with ${commandToolName}`);
    lines.push(`- If a ${commandToolName} command is blocked or declined by the user, do not retry it. Treat implementation as complete and note verification was deferred`);
  } else if (role === 'tester') {
    lines.push('- You own verification. Run the narrowest relevant checks when the environment supports them, and say clearly when checks could not run');
  }
  return lines.join('\n');
}
