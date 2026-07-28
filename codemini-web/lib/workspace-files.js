import fs from 'node:fs/promises';
import path from 'node:path';
import { INDEX_SKIP_DIRS, TEXT_EXTENSIONS } from '../../src/core/constants.js';

const PREVIEW_MAX_BYTES = 200 * 1024;
const PREVIEW_MAX_LINES = 2000;

const EXTRA_TEXT_EXTENSIONS = new Set([
  '.txt',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.env',
  '.gitignore',
  '.dockerignore',
  '.editorconfig',
  '.svg',
  '.xml',
  '.sql',
  '.graphql',
  '.gql',
  '.lock',
]);

export function isPathInside(parentDir, candidatePath) {
  const parent = path.resolve(parentDir);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(parent, candidate);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

export function normalizeWorkspaceRelativePath(rawPath = '') {
  const value = String(rawPath || '').trim().replace(/\\/g, '/');
  if (!value || value === '.') return '';
  return value.replace(/^\.?\//, '').replace(/\/+$/, '');
}

export async function resolveWorkspacePath(workspaceRoot, rawRelativePath = '') {
  const root = await fs.realpath(path.resolve(workspaceRoot));
  const relative = normalizeWorkspaceRelativePath(rawRelativePath);
  const candidate = relative ? path.resolve(root, relative) : root;
  if (!isPathInside(root, candidate)) {
    throw new Error('Path is outside the current project');
  }
  let target;
  try {
    target = await fs.realpath(candidate);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('Path does not exist');
    throw error;
  }
  if (!isPathInside(root, target)) {
    throw new Error('Path is outside the current project');
  }
  const relativeFromRoot = path.relative(root, target).split(path.sep).join('/');
  return { root, absolutePath: target, relativePath: relativeFromRoot };
}

function shouldSkipEntryName(name) {
  return INDEX_SKIP_DIRS.has(name);
}

function toPosixRelative(root, absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

function sortEntries(entries) {
  return entries.sort((left, right) => {
    if (left.type !== right.type) return left.type === 'directory' ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });
}

export async function listWorkspaceChildren(workspaceRoot, rawRelativePath = '') {
  const { root, absolutePath, relativePath } = await resolveWorkspacePath(
    workspaceRoot,
    rawRelativePath,
  );
  const stat = await fs.stat(absolutePath);
  if (!stat.isDirectory()) {
    throw new Error('Path is not a directory');
  }

  let entries = [];
  try {
    entries = await fs.readdir(absolutePath, { withFileTypes: true });
  } catch (error) {
    throw new Error(error?.message || 'Unable to read directory');
  }

  const nodes = [];
  for (const entry of entries) {
    if (!entry.name || shouldSkipEntryName(entry.name)) continue;
    const childAbsolute = path.join(absolutePath, entry.name);
    let childStat = entry;
    try {
      if (typeof entry.isSymbolicLink === 'function' && entry.isSymbolicLink()) {
        childStat = await fs.lstat(childAbsolute);
      }
    } catch {
      continue;
    }
    const isDirectory =
      typeof childStat.isDirectory === 'function'
        ? childStat.isDirectory()
        : entry.isDirectory();
    const isFile =
      typeof childStat.isFile === 'function' ? childStat.isFile() : entry.isFile();
    if (!isDirectory && !isFile) continue;

    const childRelative = toPosixRelative(root, childAbsolute);
    if (isDirectory) {
      nodes.push({
        id: childRelative,
        name: entry.name,
        path: childRelative,
        type: 'directory',
        children: [],
      });
    } else {
      nodes.push({
        id: childRelative,
        name: entry.name,
        path: childRelative,
        type: 'file',
      });
    }
  }

  return {
    rootPath: root,
    path: relativePath,
    entries: sortEntries(nodes),
  };
}

export function isPreviewableTextPath(filePath) {
  const base = path.basename(String(filePath || ''));
  const ext = path.extname(base).toLowerCase();
  if (!ext) {
    return /^(readme|license|changelog|makefile|dockerfile|gemfile|procfile)$/i.test(base);
  }
  if (TEXT_EXTENSIONS.has(ext) || EXTRA_TEXT_EXTENSIONS.has(ext)) return true;
  if (base.startsWith('.') && EXTRA_TEXT_EXTENSIONS.has(ext)) return true;
  if (/^\.env(\..+)?$/i.test(base)) return true;
  return false;
}

export async function previewWorkspaceFile(workspaceRoot, rawRelativePath = '') {
  const relativeInput = normalizeWorkspaceRelativePath(rawRelativePath);
  if (!relativeInput) throw new Error('Preview requires a file path');

  const { root, absolutePath, relativePath } = await resolveWorkspacePath(
    workspaceRoot,
    relativeInput,
  );
  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) throw new Error('Path is not a file');

  if (!isPreviewableTextPath(relativePath)) {
    return {
      kind: 'unsupported',
      path: relativePath,
      absolutePath,
      message: 'Preview not supported for this file type.',
    };
  }

  const handle = await fs.open(absolutePath, 'r');
  try {
    const size = stat.size;
    const readSize = Math.min(size, PREVIEW_MAX_BYTES + 1);
    const buffer = Buffer.alloc(readSize);
    const { bytesRead } = await handle.read(buffer, 0, readSize, 0);
    let text = buffer.subarray(0, bytesRead).toString('utf8');
    // Reject obvious binary content.
    if (text.includes('\u0000')) {
      return {
        kind: 'unsupported',
        path: relativePath,
        absolutePath,
        message: 'Preview not supported for binary files.',
      };
    }

    let truncated = size > PREVIEW_MAX_BYTES || bytesRead > PREVIEW_MAX_BYTES;
    if (bytesRead > PREVIEW_MAX_BYTES) {
      text = text.slice(0, PREVIEW_MAX_BYTES);
      truncated = true;
    }

    const lines = text.split(/\r?\n/);
    if (lines.length > PREVIEW_MAX_LINES) {
      text = lines.slice(0, PREVIEW_MAX_LINES).join('\n');
      truncated = true;
    }

    return {
      kind: 'text',
      path: relativePath,
      absolutePath,
      content: text,
      truncated,
      byteLength: size,
      rootPath: root,
    };
  } finally {
    await handle.close();
  }
}

export const WORKSPACE_PREVIEW_MAX_BYTES = PREVIEW_MAX_BYTES;
export const WORKSPACE_PREVIEW_MAX_LINES = PREVIEW_MAX_LINES;
