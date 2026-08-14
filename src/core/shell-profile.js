import path from 'node:path';
import { getReadOnlyCommandTokens } from './read-only-command-tokens.js';
import { shellToolName } from './shell-tool-name.js';
import { isVmSandbox, resolveSandboxPolicy } from './sandbox-policy.js';

const DEFAULT_SHELL = 'bash';

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

export function resolveShellContext(
  config = {},
  { platform = process.platform, cwd = process.cwd() } = {},
) {
  const sandbox = resolveSandboxPolicy({ config, cwd, platform });
  const vm = isVmSandbox(sandbox);
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const shell = vm
    ? 'bash'
    : platform === 'win32'
      ? 'powershell'
      : normalizeShellName(config?.shell?.default);
  return {
    sandbox,
    shell,
    commandPlatform: vm ? 'linux' : platform,
    commandCwd: vm ? '/workspace' : pathApi.resolve(cwd),
    commandToolName: shellToolName({
      platform: vm ? 'linux' : platform,
      shell,
    }),
  };
}

export function getEffectivePolicy(config, options = {}) {
  const profile = getShellProfile(resolveShellContext(config, options).shell);
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
  const windowsTools = profile.shell === 'powershell';
  const commandToolName = shellToolName({
    platform: windowsTools ? 'win32' : 'linux',
    shell: profile.shell,
  });
  const psGuide = profile.shell === 'powershell'
    ? `\n# PowerShell coding guidelines\n- Use native cmdlets and structured objects; inspect exceptions on failure.\n- Use \`-LiteralPath\` for user paths and \`-ErrorAction Stop\` around critical operations.\n- Keep destructive commands explicit and narrowly scoped.`
    : `\n# Bash coding guidelines\n- Quote paths and expansions; use \`--\` before user-controlled paths.\n- Use \`set -euo pipefail\` in non-trivial scripts and clean up with \`trap\`.\n- Keep destructive commands explicit and narrowly scoped.`;

  const sourceTools = windowsTools
    ? 'search_code/read/edit/write/apply_patch'
    : 'search_code/read/edit/write';
  const editRule = windowsTools
    ? 'Use edit for precise existing-file changes, apply_patch for coherent multi-file work, write for new files, and staged writes only for long whole-file output.'
    : 'Use edit old_string/new_string for existing files and write for new or intentional whole-file output.';

  return `You are Codemini CLI, an AI assistant in a ${profile.label} shell environment.${psGuide}

# Tool discipline
- Prefer ${sourceTools} over ${commandToolName} for source work; use ${commandToolName} for tests, builds, scripts, package commands, git inspection, and servers.
- Load deferred capabilities with tool_search instead of assuming they are unavailable.
- Inspect relevant source before editing. ${editRule}
- Tool arguments are JSON. Resolve relative paths from the working directory and preserve unrelated user changes.
- Use tasks for multi-step, multi-file, debugging, or implementation-plus-verification work; keep one item in_progress and settle it before a completion claim.
- Before substantial tool work, send one short progress update. If a tool fails, inspect the error; if the user declines a command, do not retry it unless asked.
- Verify with the narrowest relevant check and state anything not verified. Do not broaden the requested scope.`;
}

export function buildSubAgentShellRulesPrompt(allowedTools = [], { shell, workspaceRoot = process.cwd(), role = '', config = {} } = {}) {
  const shellContext = resolveShellContext({
    ...config,
    shell: { ...(config?.shell || {}), default: shell },
  }, { cwd: workspaceRoot });
  const effectiveShell = shellContext.shell;
  const profile = getShellProfile(effectiveShell);
  const allowed = uniqueStrings(Array.isArray(allowedTools) ? allowedTools : []);
  const commandToolName = shellContext.commandToolName;
  const toolList = allowed.map((name) => name === 'run' ? commandToolName : name).join(', ') || 'none';
  const lines = [
    `You are Codemini CLI, an AI assistant running as a pipeline sub-agent in a ${profile.label} shell environment.`,
    `Working directory: ${path.resolve(workspaceRoot || process.cwd())}`,
    '',
    '# Tool scope (strict)',
    `You may ONLY call these tools: ${toolList}`,
    `Other tools fail. Use source tools for code context and ${commandToolName} only for execution when it appears above.`,
    'Load an allowed deferred tool with tool_search when needed.',
    '',
    '# Doing tasks',
    '- Use the supplied handoff and plan context before exploring.',
    '- Stop retrying unavailable tools. Finish with the role prompt headings and a concrete Handoff.'
  ];
  if (['coder', 'refactorer', 'writer'].includes(role)) {
    lines.push(`- Own implementation, not verification, unless the task explicitly requires ${commandToolName}; otherwise hand off with Verified: deferred.`);
  } else if (role === 'tester') {
    lines.push('- You own verification. Run the narrowest relevant checks when the environment supports them, and say clearly when checks could not run');
  }
  return lines.join('\n');
}
