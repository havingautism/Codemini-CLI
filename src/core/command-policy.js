import path from 'node:path';
import { getEffectivePolicy } from './shell-profile.js';

function firstToken(command) {
  const m = String(command || '').trim().match(/^"([^"]+)"|^'([^']+)'|^(\S+)/);
  const raw = (m && (m[1] || m[2] || m[3])) || '';
  const base = path.basename(raw).toLowerCase();
  return base.replace(/\.exe$/i, '');
}

function includesAny(haystackLower, patterns = []) {
  return patterns.some((p) => haystackLower.includes(String(p).toLowerCase()));
}

function suggestionForToken(token, config) {
  const shell = String(config?.shell?.default || '').toLowerCase();
  if (token === 'find' || token === 'grep') {
    return shell === 'powershell'
      ? 'Use rg <pattern> <path> for code search, Select-String for file-local filtering, or Get-Content for local context.'
      : 'Use rg <pattern> <path> for code search, rg --files for file listing, or sed/cat for local context.';
  }
  if (shell === 'powershell') {
    return 'Prefer rg for repo search, then Get-ChildItem, Get-Content, or Select-String for local context.';
  }
  return 'Prefer rg for repo search, then sed, cat, or ls for local context.';
}

export function evaluateCommandPolicy(command, config, workspaceRoot = process.cwd()) {
  const policy = getEffectivePolicy(config);
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

  if (includesAny(lower, policy.blocked_path_patterns)) {
    return { allowed: false, reason: 'blocked protected system path' };
  }

  const token = firstToken(cmd);
  if (includesAny(token, policy.blocked_commands)) {
    return { allowed: false, reason: `blocked command: ${token}`, suggestion: suggestionForToken(token, config) };
  }

  const allowlist = Array.isArray(policy.command_allowlist) ? policy.command_allowlist : [];
  if (allowlist.length > 0 && !allowlist.includes(token)) {
    return {
      allowed: false,
      reason: `command not in allowlist: ${token}`,
      suggestion: suggestionForToken(token, config)
    };
  }

  const workspaceLower = String(workspaceRoot).toLowerCase().replace(/\//g, '\\');
  const windowsAbsPath = lower.match(/[a-z]:\\[^\s'"]+/g) || [];
  for (const p of windowsAbsPath) {
    if (!p.startsWith(workspaceLower)) {
      return { allowed: false, reason: `absolute path outside workspace: ${p}`, suggestion: suggestionForToken(token, config) };
    }
  }

  return { allowed: true };
}
