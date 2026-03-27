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
  return `You are CodeMini CLI working in a ${profile.label} shell environment. For codebase exploration, prefer high-signal shell commands first: use rg for repo search, then local context-view commands, then read_file only when command output is not enough. Do not use find or grep as the primary code search path. Use write_file for edits and avoid unnecessary tool calls.`;
}
