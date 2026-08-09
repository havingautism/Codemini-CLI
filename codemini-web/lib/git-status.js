import fs from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';

async function runGit(cwd, args) {
  return execa('git', args, {
    cwd,
    reject: false,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

function parseGitNumstat(text) {
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    const [addedRaw, removedRaw] = line.split('\t');
    if (addedRaw !== '-') linesAdded += Number(addedRaw) || 0;
    if (removedRaw !== '-') linesRemoved += Number(removedRaw) || 0;
  }
  return { linesAdded, linesRemoved };
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const items = Array.isArray(values) ? values : [];
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await mapper(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function getGitBranch(cwd) {
  const symbolic = await runGit(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (symbolic.exitCode === 0) return String(symbolic.stdout || '').trim() || null;
  const fallback = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = String(fallback.stdout || '').trim();
  return fallback.exitCode === 0 && branch !== 'HEAD' ? branch : null;
}

async function countUntrackedLineStats(cwd) {
  const result = await runGit(cwd, ['ls-files', '--others', '--exclude-standard', '-z']);
  const files = String(result.stdout || '').split('\0').filter(Boolean);
  const counts = await mapWithConcurrency(files, 8, async (relativePath) => {
    try {
      const content = await fs.readFile(path.join(cwd, relativePath), 'utf8');
      return content ? content.split('\n').length : 0;
    } catch {
      return 0;
    }
  });
  return { linesAdded: counts.reduce((sum, count) => sum + count, 0), linesRemoved: 0 };
}

async function readGitLineStats(cwd) {
  const [head, untracked] = await Promise.all([
    runGit(cwd, ['rev-parse', '--verify', 'HEAD']),
    countUntrackedLineStats(cwd),
  ]);
  if (head.exitCode === 0) {
    const diff = await runGit(cwd, ['diff', 'HEAD', '--numstat']);
    const stats = parseGitNumstat(diff.stdout);
    return {
      linesAdded: stats.linesAdded + untracked.linesAdded,
      linesRemoved: stats.linesRemoved + untracked.linesRemoved,
    };
  }
  const [cached, unstaged] = await Promise.all([
    runGit(cwd, ['diff', '--cached', '--numstat']),
    runGit(cwd, ['diff', '--numstat']),
  ]);
  const cachedStats = parseGitNumstat(cached.stdout);
  const unstagedStats = parseGitNumstat(unstaged.stdout);
  return {
    linesAdded: cachedStats.linesAdded + unstagedStats.linesAdded + untracked.linesAdded,
    linesRemoved: cachedStats.linesRemoved + unstagedStats.linesRemoved,
  };
}

async function readGitStatusEntries(cwd) {
  const result = await runGit(cwd, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  ]);
  const records = String(result.stdout || '').split('\0').filter(Boolean);
  const statusByPath = new Map();
  for (let index = 0; index < records.length; index += 1) {
    const line = records[index];
    if (line.length < 4) continue;
    const x = line[0];
    const y = line[1];
    const filePath = line.slice(3);
    let status;
    if (x === '?' && y === '?') status = '?';
    else if (x === 'A' || y === 'A') status = 'A';
    else if (x === 'D' || y === 'D') status = 'D';
    else status = 'M';
    statusByPath.set(filePath, {
      path: filePath,
      status,
      staged: x !== ' ' && x !== '?',
      modified: y === 'M' || y === 'D',
    });
    if (x === 'R' || y === 'R' || x === 'C' || y === 'C') index += 1;
  }
  return statusByPath;
}

async function readGitDiffPatch(cwd) {
  const [head, untrackedResult] = await Promise.all([
    runGit(cwd, ['rev-parse', '--verify', 'HEAD']),
    runGit(cwd, ['ls-files', '--others', '--exclude-standard', '-z']),
  ]);
  const trackedPatch = head.exitCode === 0
    ? String((await runGit(cwd, ['diff', 'HEAD', '--no-color'])).stdout || '').trim()
    : (await Promise.all([
        runGit(cwd, ['diff', '--cached', '--no-color']),
        runGit(cwd, ['diff', '--no-color']),
      ]))
        .map((result) => String(result.stdout || '').trim())
        .filter(Boolean)
        .join('\n');
  const nullPath = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const untrackedFiles = String(untrackedResult.stdout || '').split('\0').filter(Boolean);
  const untrackedPatches = await mapWithConcurrency(untrackedFiles, 4, async (relativePath) => {
    const result = await runGit(cwd, ['diff', '--no-index', '--no-color', '--', nullPath, relativePath]);
    return String(result.stdout || '').trim();
  });
  return [trackedPatch, ...untrackedPatches].filter(Boolean).join('\n');
}

export async function readGitDiffData(cwd) {
  const [patch, statusByPath, lineStats] = await Promise.all([
    readGitDiffPatch(cwd),
    readGitStatusEntries(cwd),
    readGitLineStats(cwd),
  ]);
  const patchFiles = [];
  const seenPatchFiles = new Set();
  for (const line of patch.split('\n')) {
    const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (!match) continue;
    const filePath = match[2] || match[1];
    if (!filePath || seenPatchFiles.has(filePath)) continue;
    seenPatchFiles.add(filePath);
    patchFiles.push(filePath);
  }
  const files = patchFiles.map(
    (filePath) => statusByPath.get(filePath) || { path: filePath, status: 'M', staged: false },
  );
  for (const [filePath, entry] of statusByPath.entries()) {
    if (entry.status === '?' && !seenPatchFiles.has(filePath)) files.push(entry);
  }
  return { patch, files, ...lineStats };
}

export async function readGitInfoUncached(cwd, { includeCounts = true } = {}) {
  const rootCheck = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (rootCheck.exitCode !== 0 || String(rootCheck.stdout || '').trim() !== 'true') {
    throw new Error('Not a git repository');
  }
  if (!includeCounts) {
    return { isGit: true, branch: await getGitBranch(cwd) };
  }

  const [branch, statusByPath, lineStats] = await Promise.all([
    getGitBranch(cwd),
    readGitStatusEntries(cwd),
    readGitLineStats(cwd),
  ]);
  const files = [...statusByPath.values()];
  let staged = 0;
  let modified = 0;
  let untracked = 0;
  for (const file of files) {
    if (file.status === '?') {
      untracked += 1;
      continue;
    }
    if (file.staged) staged += 1;
    if (file.modified) modified += 1;
  }
  return {
    isGit: true,
    branch,
    dirty: files.length > 0,
    staged,
    modified,
    untracked,
    files,
    ...lineStats,
  };
}

export function createGitInfoReader({ loader = readGitInfoUncached, ttlMs = 750, maxSize = 64 } = {}) {
  const cache = new Map();
  const pending = new Map();
  return async (cwd, { includeCounts = true } = {}) => {
    const resolved = path.resolve(String(cwd || '.'));
    const key = `${process.platform === 'win32' ? resolved.toLowerCase() : resolved}:${includeCounts ? 'full' : 'branch'}`;
    const now = Date.now();
    const cached = cache.get(key);
    if (cached && now - cached.at <= ttlMs) return cached.value;
    if (pending.has(key)) return pending.get(key);

    const request = Promise.resolve(loader(resolved, { includeCounts }))
      .then((value) => {
        cache.set(key, { at: Date.now(), value });
        while (cache.size > maxSize) cache.delete(cache.keys().next().value);
        return value;
      })
      .finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  };
}

export async function readGitInfoBatch(
  dirs,
  { reader, concurrency = 4, includeCounts = false } = {},
) {
  if (typeof reader !== 'function') throw new TypeError('reader must be a function');
  const uniqueDirs = [...new Set((Array.isArray(dirs) ? dirs : []).filter(Boolean))];
  const entries = await mapWithConcurrency(uniqueDirs, concurrency, async (dir) => {
    try {
      return [dir, await reader(path.resolve(dir), { includeCounts })];
    } catch {
      return [dir, { isGit: false, branch: null }];
    }
  });
  return Object.fromEntries(entries);
}
