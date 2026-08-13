import path from 'node:path';
import { getEffectivePolicy } from './shell-profile.js';
import { getBaseConfigDir } from './paths.js';
import { isVmSandbox, resolveSandboxPolicy } from './sandbox-policy.js';
import { inspectShellCommandPaths } from './shell-path-policy.js';

const SHELL_KEYWORDS = new Set([
  'if',
  'then',
  'elif',
  'else',
  'fi',
  'for',
  'while',
  'until',
  'do',
  'done',
  'case',
  'esac',
  'in',
  'function',
  'time',
  '{',
  '}'
]);

function firstToken(command) {
  const m = String(command || '').trim().match(/^"([^"]+)"|^'([^']+)'|^(\S+)/);
  const raw = (m && (m[1] || m[2] || m[3])) || '';
  const base = path.basename(raw).toLowerCase();
  return base.replace(/\.exe$/i, '');
}

function splitCommandSegments(command) {
  const text = String(command || '').trim();
  if (!text) return [];
  const segments = [];
  let current = '';
  let quote = '';
  let escapeNext = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (escapeNext) {
      current += ch;
      escapeNext = false;
      continue;
    }

    if (ch === '\\' && quote !== '\'') {
      current += ch;
      escapeNext = true;
      continue;
    }

    if (quote) {
      current += ch;
      if (ch === quote) quote = '';
      continue;
    }

    if (ch === '"' || ch === '\'') {
      quote = ch;
      current += ch;
      continue;
    }

    if ((ch === '&' && next === '&') || (ch === '|' && next === '|')) {
      if (current.trim()) segments.push(current.trim());
      current = '';
      i += 1;
      continue;
    }

    if (ch === '&' && text[i - 1] === '>') {
      current += ch;
      continue;
    }

    if (ch === '|' || ch === ';' || ch === '&') {
      if (current.trim()) segments.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.trim()) segments.push(current.trim());
  return segments;
}

function tokenizeTopLevel(command) {
  const text = String(command || '').trim();
  if (!text) return [];
  const tokens = [];
  let current = '';
  let quote = '';
  let escapeNext = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (escapeNext) {
      current += ch;
      escapeNext = false;
      continue;
    }
    if (ch === '\\' && quote !== '\'') {
      escapeNext = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = '';
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === '\'') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }

  if (current) tokens.push(current);
  return tokens;
}

function unwrapShellPayload(command) {
  const tokens = tokenizeTopLevel(command);
  const token = firstToken(command);
  if (!['bash', 'sh', 'zsh', 'powershell', 'pwsh', 'cmd'].includes(token)) return '';

  const index = tokens.findIndex((item, itemIndex) => {
    if (token === 'cmd') return itemIndex > 0 && /^\/c$/i.test(item);
    return /^-(?:c|lc|command)$/i.test(item);
  });
  if (index < 0 || index + 1 >= tokens.length) return '';
  return tokens.slice(index + 1).join(' ').trim();
}

function collectCommandTokens(command) {
  const cmd = String(command || '').trim();
  if (!cmd) return [];

  const chained = splitCommandSegments(cmd);
  if (chained.length > 1) {
    return chained.flatMap((segment) => collectCommandTokens(segment));
  }

  const token = firstToken(cmd);
  const out = token ? [{ token, raw: cmd }] : [];
  const wrapped = unwrapShellPayload(cmd);
  if (wrapped && wrapped !== cmd) {
    out.push(...collectCommandTokens(wrapped));
  }
  return out;
}

function includesAny(haystackLower, patterns = []) {
  return patterns.some((p) => haystackLower.includes(String(p).toLowerCase()));
}

/** bash 下会被阻止的删除类命令 token */
const BASH_DELETE_TOKENS = new Set(['rm', 'rmdir']);
/** PowerShell 下会被阻止的删除类命令 token */
const POWERSHELL_DELETE_TOKENS = new Set(['del', 'erase', 'rmdir', 'rd', 'remove-item', 'ri']);

function suggestionForToken(token, config) {
  const shell = String(config?.shell?.default || '').toLowerCase();

  /* 删除类命令：优先引导 LLM 使用 delete 工具 */
  if (
    (shell !== 'powershell' && BASH_DELETE_TOKENS.has(token)) ||
    (shell === 'powershell' && POWERSHELL_DELETE_TOKENS.has(token))
  ) {
    return 'Use the delete tool to remove files or directories inside the workspace. Do not use shell commands for deletion.';
  }

  if (token === 'find' || token === 'grep') {
    return shell === 'powershell'
      ? 'Prefer structured tools like grep, list, read, and edit first. If you need shell fallback, use allowed search and context commands such as Get-ChildItem, Select-String, Get-Content, or rg when available.'
      : 'Prefer structured tools like grep, glob, list, read, and edit first. If you need shell fallback, use allowed search and context commands such as rg, find, grep, sed, cat, or ls.';
  }
  if (shell === 'powershell') {
    return 'Prefer structured tools like read, edit, create, grep, and list first. If you need shell fallback, use allowed shell commands for search and local context such as Get-ChildItem, Get-Content, Select-String, or rg when available.';
  }
  return 'Prefer structured tools like read, edit, create, grep, glob, and list first. If you need shell fallback, use allowed shell commands for search and local context such as rg, find, grep, sed, cat, or ls.';
}

function allowedPathRoots(workspaceRoot, config = {}) {
  return [
    workspaceRoot,
    path.join(getBaseConfigDir(), 'workspace'),
    ...(Array.isArray(config?.policy?.allowed_paths) ? config.policy.allowed_paths : [])
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function validateCdSegment(command) {
  const tokens = tokenizeTopLevel(command);
  if (tokens.length === 1) {
    return { allowed: false, reason: 'cd requires a target path in safe mode' };
  }
  if (tokens.length !== 2) {
    return { allowed: false, reason: 'cd only supports a single target path in safe mode' };
  }

  const rawTarget = String(tokens[1] || '').trim();
  if (!rawTarget || rawTarget.startsWith('-')) {
    return { allowed: false, reason: 'cd target is not allowed in safe mode' };
  }

  return { allowed: true };
}

export function evaluateCommandPolicy(command, config, workspaceRoot = process.cwd(), platform = process.platform) {
  const policy = getEffectivePolicy(config, { cwd: workspaceRoot, platform });
  const sandbox = resolveSandboxPolicy({ config, cwd: workspaceRoot, platform });
  const cmd = String(command || '').trim();
  const lower = cmd.toLowerCase();
  if (!cmd) {
    return { allowed: false, reason: 'empty command' };
  }

  if (!policy.allow_dangerous_commands && includesAny(lower, policy.blocked_command_patterns)) {
    return { allowed: false, reason: 'blocked by dangerous command pattern' };
  }

  if (!policy.safe_mode) {
    return { allowed: true };
  }

  // The Linux microVM is the command boundary. Reapplying the host-oriented
  // allowlist and path parser here rejects valid guest commands and paths such
  // as curl and /workspace without adding host protection.
  if (isVmSandbox(sandbox)) {
    const explicitBlockedPaths = Array.isArray(config?.policy?.blocked_path_patterns)
      ? config.policy.blocked_path_patterns
      : [];
    if (includesAny(lower, explicitBlockedPaths)) {
      return { allowed: false, reason: 'blocked protected system path' };
    }
    const explicitBlockedCommands = Array.isArray(config?.policy?.blocked_commands)
      ? config.policy.blocked_commands
      : [];
    const explicitAllowlist = Array.isArray(config?.policy?.command_allowlist)
      ? config.policy.command_allowlist
      : [];
    for (const item of collectCommandTokens(cmd)) {
      if (includesAny(item.token, explicitBlockedCommands)) {
        return { allowed: false, reason: `blocked command: ${item.token}`, suggestion: suggestionForToken(item.token, config) };
      }
      if (explicitAllowlist.length > 0 && !explicitAllowlist.includes(item.token)) {
        return { allowed: false, reason: `command not in allowlist: ${item.token}`, suggestion: suggestionForToken(item.token, config) };
      }
    }
    return { allowed: true };
  }

  if (includesAny(lower, policy.blocked_path_patterns)) {
    return { allowed: false, reason: 'blocked protected system path' };
  }

  const token = firstToken(cmd);
  const inspectedTokens = collectCommandTokens(cmd);
  const allowlist = Array.isArray(policy.command_allowlist) ? policy.command_allowlist : [];
  for (const item of inspectedTokens) {
    if (SHELL_KEYWORDS.has(item.token)) continue;
    if (item.token === 'cd') {
      const cdCheck = validateCdSegment(item.raw);
      if (!cdCheck.allowed) {
        return { allowed: false, reason: cdCheck.reason, suggestion: suggestionForToken(item.token, config) };
      }
    }
    if (includesAny(item.token, policy.blocked_commands)) {
      return { allowed: false, reason: `blocked command: ${item.token}`, suggestion: suggestionForToken(item.token, config) };
    }
    if (allowlist.length > 0 && !allowlist.includes(item.token)) {
      return {
        allowed: false,
        reason: `command not in allowlist: ${item.token}`,
        suggestion: suggestionForToken(item.token, config)
      };
    }
  }

  const allowedRoots = allowedPathRoots(workspaceRoot, config);
  const pathInspection = inspectShellCommandPaths({
    command: cmd,
    shell: config?.shell?.default,
    workspaceRoot,
    allowedRoots,
  });
  const outside = pathInspection.outside[0];
  if (outside) {
    const reason = outside.kind === 'relative-escape'
      ? `relative path escapes workspace or allowed paths: ${outside.value}`
      : `absolute path outside workspace or allowed paths: ${outside.value}`;
    return { allowed: false, reason, suggestion: suggestionForToken(token, config) };
  }

  return { allowed: true };
}

export { collectCommandTokens, firstToken };
