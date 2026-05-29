import path from 'node:path';
import fg from 'fast-glob';

export function buildSkipDirIgnores(skipDirs) {
  const names = [...(skipDirs instanceof Set ? skipDirs : skipDirs)];
  return names.flatMap((name) => [`**/${name}`, `**/${name}/**`]);
}

function hasSkippedSegment(relativePath, skipDirs, { allowRoot = false } = {}) {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\.\/?/, '');
  if (!normalized || normalized === '.') return false;
  const segments = normalized.split('/').filter(Boolean);
  for (const segment of segments) {
    if (!skipDirs.has(segment)) continue;
    if (allowRoot && segments.length === 1 && segments[0] === segment) continue;
    return true;
  }
  return false;
}

function isHiddenEntry(relativePath, includeHidden) {
  if (includeHidden) return false;
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\.\/?/, '');
  if (!normalized || normalized === '.') return false;
  return normalized.split('/').some((segment) => segment.startsWith('.'));
}

/**
 * List files under rootAbs (absolute path). Returns absolute file paths.
 */
export async function globFilesUnder(rootAbs, {
  includeHidden = false,
  skipDirs = new Set(),
  extraIgnore = []
} = {}) {
  const ignore = [...buildSkipDirIgnores(skipDirs), ...extraIgnore];
  const matches = await fg('**/*', {
    cwd: rootAbs,
    absolute: true,
    onlyFiles: true,
    dot: includeHidden,
    ignore,
    suppressErrors: true,
    followSymbolicLinks: false
  });

  return matches.filter((absolutePath) => {
    const relative = path.relative(rootAbs, absolutePath);
    if (hasSkippedSegment(relative, skipDirs)) return false;
    if (isHiddenEntry(relative, includeHidden)) return false;
    return true;
  });
}

/**
 * List files and directories under rootAbs. Returns { path, name, type } with posix-relative paths.
 */
export async function globWorkspaceEntriesUnder(rootAbs, {
  includeHidden = false,
  skipDirs = new Set()
} = {}) {
  const ignore = buildSkipDirIgnores(skipDirs);
  const matches = await fg('**', {
    cwd: rootAbs,
    absolute: true,
    onlyFiles: false,
    dot: includeHidden,
    ignore,
    suppressErrors: true,
    followSymbolicLinks: false,
    stats: true
  });

  const entries = [];
  for (const entry of matches) {
    const absolutePath = entry.path;
    const relative = path.relative(rootAbs, absolutePath).replace(/\\/g, '/');
    if (!relative) continue;
    if (hasSkippedSegment(relative, skipDirs)) continue;
    if (isHiddenEntry(relative, includeHidden)) continue;
    const name = path.basename(absolutePath);
    const type = entry.stats?.isDirectory() ? 'dir' : 'file';
    entries.push({ path: relative, name, type });
  }

  entries.sort((left, right) => {
    if (left.type !== right.type) return left.type === 'dir' ? -1 : 1;
    return left.path.localeCompare(right.path);
  });

  return entries;
}
