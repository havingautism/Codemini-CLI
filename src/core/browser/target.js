import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BROWSER_ROLES } from './schema.js';
import { browserError } from './result.js';

function field(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function validateTarget(args = {}, { required = true } = {}) {
  const ref = field(args.ref);
  const selector = field(args.selector);
  const role = field(args.role);
  const name = field(args.name);
  const modes = [ref && 'ref', selector && 'selector', role && 'role'].filter(Boolean);

  if (!required && modes.length === 0 && !name) {
    return { ok: true, target: null };
  }
  if (name && !role) {
    return {
      ok: false,
      code: 'INVALID_TARGET',
      error: 'name requires role. Example: {"role":"button","name":"Save"}. Or pass ref from browser_inspect snapshot.',
    };
  }
  if (role && !name) {
    return {
      ok: false,
      code: 'INVALID_TARGET',
      error: 'role requires name. Example: {"role":"button","name":"Save"}.',
    };
  }
  if (role && !BROWSER_ROLES.includes(role)) {
    return {
      ok: false,
      code: 'INVALID_TARGET',
      error: `role must be one of: ${BROWSER_ROLES.join(', ')}.`,
    };
  }
  if (modes.length === 0) {
    return {
      ok: false,
      code: 'INVALID_TARGET',
      error: 'Provide ref (@eN from browser_inspect snapshot), selector, or role plus name.',
    };
  }
  if (modes.length > 1) {
    return {
      ok: false,
      code: 'INVALID_TARGET',
      error: 'Provide only one of ref, selector, or role plus name.',
    };
  }
  if (ref && !/^@e[1-9][0-9]*$/.test(ref)) {
    return {
      ok: false,
      code: 'INVALID_TARGET',
      error: 'ref must look like @e1. Call browser_inspect snapshot to refresh refs.',
    };
  }
  return {
    ok: true,
    target: {
      ...(ref ? { ref } : {}),
      ...(selector ? { selector } : {}),
      ...(role ? { role, name } : {}),
    },
  };
}

export function targetError(tool, parsed) {
  return browserError(tool, parsed.code || 'INVALID_TARGET', parsed.error);
}

export function describeTarget(target) {
  if (!target) return 'page';
  if (target.ref) return target.ref;
  if (target.selector) return target.selector;
  if (target.role) return `${target.role} "${target.name || ''}"`;
  return 'element';
}

function insideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolvePageUrl(workspaceRoot, raw) {
  const value = String(raw || '').trim();
  if (!value) return { url: 'about:blank' };
  if (value.length > 2000) {
    return { error: 'URL is longer than 2000 characters.' };
  }
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { error: 'Only http(s) URLs, about:blank, or a workspace file are allowed.' };
      }
      return { url: parsed.href };
    } catch {
      return { error: 'URL is not valid.' };
    }
  }
  if (/^about:blank$/i.test(value)) return { url: 'about:blank' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^file:/i.test(value)) {
    return { error: 'Only http(s) URLs, about:blank, or a workspace file are allowed.' };
  }

  let filePath = value;
  if (/^file:/i.test(value)) {
    try {
      filePath = fileURLToPath(value);
    } catch {
      return { error: 'file URL is not valid.' };
    }
  }
  const root = path.resolve(workspaceRoot || process.cwd());
  const absolute = path.resolve(root, filePath);
  const rootReal = existsSync(root) ? realpathSync(root) : root;
  let targetReal = absolute;
  try {
    if (existsSync(absolute)) targetReal = realpathSync(absolute);
  } catch {
    targetReal = absolute;
  }
  if (!insideRoot(rootReal, targetReal)) {
    return { error: 'File path must stay inside the workspace.' };
  }
  if (!existsSync(targetReal)) {
    const relative = path.relative(rootReal, absolute) || filePath;
    return { error: `File not found: ${relative}` };
  }
  return { url: pathToFileURL(targetReal).href };
}
