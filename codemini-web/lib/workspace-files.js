import fs from 'node:fs/promises';
import path from 'node:path';
import { INDEX_SKIP_DIRS, TEXT_EXTENSIONS } from '../../src/core/constants.js';

const PREVIEW_MAX_BYTES = 200 * 1024;
const PREVIEW_MAX_LINES = 2000;
export const HTML_ARTIFACT_MAX_BYTES = 2 * 1024 * 1024;

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

const IMAGE_PREVIEW_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
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

export async function readWorkspaceHtmlArtifact(
  workspaceRoot,
  rawRelativePath = '',
  { maxBytes = HTML_ARTIFACT_MAX_BYTES } = {},
) {
  const { root, absolutePath, relativePath } = await resolveWorkspacePath(
    workspaceRoot,
    rawRelativePath,
  );
  if (!/\.html?$/i.test(relativePath)) {
    throw new Error('Interactive artifacts require an .html or .htm file');
  }
  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) throw new Error('HTML artifact path is not a file');
  if (stat.size > maxBytes) {
    throw new Error(`HTML artifact exceeds the ${maxBytes} byte limit`);
  }
  return {
    rootPath: root,
    absolutePath,
    path: relativePath,
    byteLength: stat.size,
    content: await fs.readFile(absolutePath, 'utf8'),
  };
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

const FILE_SEARCH_MAX_RESULTS = 40;
const FILE_SEARCH_MAX_FILES = 4000;
const FILE_SEARCH_CACHE_TTL_MS = 2500;
const FILE_SEARCH_CACHE_MAX_ROOTS = 8;
const fileSearchCatalogCache = new Map();

function subsequencePenalty(value, needle) {
  let cursor = 0;
  let first = -1;
  let last = -1;
  for (const char of needle) {
    const found = value.indexOf(char, cursor);
    if (found < 0) return null;
    if (first < 0) first = found;
    last = found;
    cursor = found + 1;
  }
  return first + Math.max(0, last - first - needle.length + 1);
}

function scoreFileMatch(relativePath, name, needle) {
  let score = 0;
  if (!needle) {
    const depth = relativePath.split('/').length - 1;
    score = depth + (depth === 0 ? -2 : 0);
  } else {
    const lowerName = name.toLowerCase();
    const lowerPath = relativePath.toLowerCase();
    const namePenalty = subsequencePenalty(lowerName, needle);
    const pathPenalty = subsequencePenalty(lowerPath, needle);
    if (lowerPath === needle) score = 0;
    else if (lowerName === needle) score = 1;
    else if (lowerName.startsWith(needle)) score = 2;
    else if (lowerPath.startsWith(needle)) score = 3;
    else if (lowerName.includes(needle)) score = 4;
    else if (lowerPath.includes(needle)) score = 5;
    else if (namePenalty != null) score = 10 + namePenalty;
    else if (pathPenalty != null) score = 30 + pathPenalty;
    else return null;
  }
  if (relativePath.split('/').some((segment) => segment.startsWith('.'))) {
    score += 20;
  }
  return score;
}

async function buildWorkspaceFileCatalog(root) {
  const files = [];
  const pendingDirectories = [{ absolute: root, relative: '' }];
  let directoryCursor = 0;
  let visited = 0;

  while (directoryCursor < pendingDirectories.length && visited < FILE_SEARCH_MAX_FILES) {
    const directory = pendingDirectories[directoryCursor];
    directoryCursor += 1;
    let entries;
    try {
      entries = await fs.readdir(directory.absolute, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (visited >= FILE_SEARCH_MAX_FILES) break;
      if (!entry.name || INDEX_SKIP_DIRS.has(entry.name) || entry.isSymbolicLink()) continue;
      const relativePath = directory.relative
        ? `${directory.relative}/${entry.name}`
        : entry.name;
      if (entry.isDirectory()) {
        pendingDirectories.push({
          absolute: path.join(directory.absolute, entry.name),
          relative: relativePath,
        });
      } else if (entry.isFile()) {
        visited += 1;
        files.push({ path: relativePath, name: entry.name });
      }
    }
  }
  return { files, truncated: visited >= FILE_SEARCH_MAX_FILES };
}

async function getWorkspaceFileCatalog(root) {
  const now = Date.now();
  const cached = fileSearchCatalogCache.get(root);
  if (cached && cached.expiresAt > now) return cached.promise;
  const entry = {
    expiresAt: Number.POSITIVE_INFINITY,
    promise: null,
  };
  const promise = buildWorkspaceFileCatalog(root).finally(() => {
    entry.expiresAt = Date.now() + FILE_SEARCH_CACHE_TTL_MS;
  });
  entry.promise = promise;
  fileSearchCatalogCache.delete(root);
  fileSearchCatalogCache.set(root, entry);
  while (fileSearchCatalogCache.size > FILE_SEARCH_CACHE_MAX_ROOTS) {
    fileSearchCatalogCache.delete(fileSearchCatalogCache.keys().next().value);
  }
  return promise;
}

export async function searchWorkspaceFiles(
  workspaceRoot,
  rawQuery = '',
  { limit = FILE_SEARCH_MAX_RESULTS } = {},
) {
  const root = await fs.realpath(path.resolve(workspaceRoot));
  const needle = String(rawQuery || '')
    .trim()
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
  const catalog = await getWorkspaceFileCatalog(root);
  const matches = catalog.files.flatMap((file) => {
    const score = scoreFileMatch(file.path, file.name, needle);
    return score == null ? [] : [{ ...file, score }];
  });
  matches.sort(
    (left, right) =>
      left.score - right.score ||
      left.path.localeCompare(right.path, undefined, { sensitivity: 'base' }),
  );
  return {
    rootPath: root,
    query: needle,
    scanned: catalog.files.length,
    truncated: catalog.truncated,
    files: matches
      .slice(0, limit)
      .map(({ path: relativePath, name }) => ({ path: relativePath, name })),
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

export function isPreviewableImagePath(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return IMAGE_PREVIEW_EXTENSIONS.has(ext);
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

  if (isPreviewableImagePath(relativePath)) {
    return {
      kind: 'image',
      path: relativePath,
      absolutePath,
      rootPath: root,
      byteLength: stat.size,
    };
  }

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
