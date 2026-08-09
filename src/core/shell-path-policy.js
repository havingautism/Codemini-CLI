import path from 'node:path';
import { parse as parseShell } from 'shell-quote';

const POSIX_SPECIAL_PATHS = new Set(['/dev/null', '/dev/stdin', '/dev/stdout', '/dev/stderr']);
const REDIRECT_OPERATORS = new Set(['>', '>>', '<', '>&', '<&']);

function pathApiForShell(shell = '') {
  return String(shell || '').toLowerCase() === 'powershell' ? path.win32 : path.posix;
}

function splitPowerShellTokens(command) {
  const tokens = [];
  let current = '';
  let quote = '';
  let escaped = false;
  const flush = () => {
    if (current) tokens.push(current);
    current = '';
  };
  for (const ch of String(command || '')) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === '`') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = '';
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch) || [';', '|', '&', '>', '<'].includes(ch)) {
      flush();
      continue;
    }
    current += ch;
  }
  flush();
  return tokens;
}

function unwrapAssignedPath(value = '') {
  const text = String(value || '');
  const equals = text.indexOf('=');
  return equals >= 0 ? text.slice(equals + 1) : text;
}

function collectPowerShellCandidates(command) {
  return splitPowerShellTokens(command).map((value) => ({ value: unwrapAssignedPath(value), role: 'argument' }));
}

function collectBashCandidates(command) {
  const parsed = parseShell(String(command || ''), (name) => `$${name}`);
  const candidates = [];
  let previousOperator = '';
  for (const item of parsed) {
    if (typeof item === 'object' && item?.op) {
      if (item.op === 'glob') candidates.push({ value: item.pattern, role: 'glob' });
      previousOperator = item.op;
      continue;
    }
    if (typeof item !== 'string') continue;
    candidates.push({
      value: unwrapAssignedPath(item),
      role: REDIRECT_OPERATORS.has(previousOperator) ? 'redirect' : 'argument',
    });
    previousOperator = '';
  }
  return candidates;
}

function classifyCandidate(candidate, { shell, workspaceRoot, allowedRoots }) {
  const api = pathApiForShell(shell);
  const value = String(candidate?.value || '').trim();
  if (!value) return { ...candidate, kind: 'other' };
  if (api === path.posix && POSIX_SPECIAL_PATHS.has(value)) return { ...candidate, kind: 'special' };
  if (api === path.win32 && /^nul:?$/i.test(value)) {
    return { ...candidate, kind: 'special' };
  }
  if (/[$%]/.test(value)) return { ...candidate, kind: 'dynamic' };

  const absolute = api.isAbsolute(value);
  const relativeEscape = /^(?:\.\.[\\/])+/i.test(value);
  if (!absolute && !relativeEscape) return { ...candidate, kind: candidate.role === 'glob' ? 'glob' : 'relative' };

  const resolved = api.resolve(workspaceRoot, value);
  const inside = allowedRoots.some((root) => {
    const relative = api.relative(api.resolve(root), resolved);
    return relative === '' || (!relative.startsWith('..') && !api.isAbsolute(relative));
  });
  return { ...candidate, value, resolved, kind: absolute ? 'absolute' : 'relative-escape', outside: !inside };
}

/** Parse shell words, then classify only real path arguments against trusted roots. */
export function inspectShellCommandPaths({
  command = '',
  shell = 'bash',
  workspaceRoot = process.cwd(),
  allowedRoots = [workspaceRoot],
} = {}) {
  try {
    const rawCandidates = String(shell || '').toLowerCase() === 'powershell'
      ? collectPowerShellCandidates(command)
      : collectBashCandidates(command);
    const candidates = rawCandidates.map((candidate) => classifyCandidate(candidate, {
      shell,
      workspaceRoot,
      allowedRoots,
    }));
    return {
      candidates,
      outside: candidates.filter((candidate) => candidate.outside === true),
      parseError: '',
    };
  } catch (error) {
    return {
      candidates: [],
      outside: [],
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}
