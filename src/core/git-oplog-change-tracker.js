import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { normalizePath } from './string-utils.js';
import { runGit } from './process-run.js';
import {
  listChangeOperationsFromSqlite,
  loadChangeOperationFromSqlite,
  saveChangeOperationToSqlite
} from './change-oplog-sqlite-store.js';

const CHANGE_OPLOG_VERSION = 1;
const FILE_TOOLS = new Set(['edit', 'create', 'write', 'apply_patch', 'delete']);

function ensurePatchNewline(patch) {
  const text = String(patch || '');
  if (!text) return text;
  return text.endsWith('\n') ? text : `${text}\n`;
}

function changeId(prefix = 'op') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${rand}`;
}

function normalizeRelativePath(value, { root = '' } = {}) {
  let text = normalizePath(String(value || '').trim()).replace(/:\d+(?:-\d+)?$/, '');
  if (!text || text === '.') return '';
  if (/^[a-zA-Z]:\//.test(text) || text.startsWith('/')) {
    if (!root) return '';
    const absRoot = path.resolve(root);
    const absTarget = path.resolve(text);
    const rel = path.relative(absRoot, absTarget);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return '';
    text = normalizePath(rel);
  }
  if (text.startsWith('../')) return '';
  return text;
}

function extractPathCandidates(args = {}, declaredChanges = [], options = {}) {
  const candidates = [];
  for (const change of Array.isArray(declaredChanges) ? declaredChanges : [declaredChanges]) {
    if (change?.path) candidates.push(change.path);
  }
  for (const value of [
    args?.path,
    args?.target,
  ]) {
    if (typeof value === 'string') candidates.push(value);
  }
  const patchText = String(args?.patch_text || '');
  if (patchText) {
    for (const match of patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
      candidates.push(match[1]);
    }
    for (const match of patchText.matchAll(/^\*\*\* Move to: (.+)$/gm)) {
      candidates.push(match[1]);
    }
  }
  const out = [];
  const seen = new Set();
  for (const value of candidates) {
    const normalized = normalizeRelativePath(value, options);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function parseStatusPaths(text) {
  const parts = String(text || '').split('\0').filter(Boolean);
  const paths = [];
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    const filePath = normalizeRelativePath(entry.slice(3));
    if (filePath) paths.push(filePath);
    if (status.includes('R') || status.includes('C')) {
      i += 1;
      const renamedPath = normalizeRelativePath(parts[i] || '');
      if (renamedPath) paths.push(renamedPath);
    }
  }
  return [...new Set(paths)];
}

async function readWorktreeSnapshot(root, relativePath) {
  const abs = path.resolve(root, relativePath);
  if (!abs.startsWith(`${root}${path.sep}`) && abs !== root) {
    return { exists: false, content: Buffer.alloc(0), hash: '' };
  }
  try {
    const content = await fs.readFile(abs);
    return { exists: true, content, hash: hashBuffer(content) };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, content: Buffer.alloc(0), hash: '' };
    throw error;
  }
}

async function readHeadSnapshot(root, relativePath) {
  try {
    const result = await runGit(['show', `HEAD:${relativePath}`], {
      cwd: root,
      allowFailure: true,
      timeoutMs: 60_000
    });
    if (result.code !== 0) return { exists: false, content: Buffer.alloc(0), hash: '' };
    return { exists: true, content: result.stdoutBuffer, hash: hashBuffer(result.stdoutBuffer) };
  } catch {
    return { exists: false, content: Buffer.alloc(0), hash: '' };
  }
}

function hashBuffer(buffer) {
  let hash = 5381;
  for (const byte of buffer) hash = ((hash << 5) + hash + byte) >>> 0;
  return hash.toString(16);
}

function countPatchLines(patch) {
  let added = 0;
  let removed = 0;
  for (const line of String(patch || '').split(/\r?\n/)) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) removed += 1;
  }
  return { added, removed };
}

function firstChangedLineFromPatch(patch) {
  const match = String(patch || '').match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/m);
  return match ? Math.max(1, Number(match[1]) || 1) : 0;
}

function actionFromSnapshots(before, after) {
  if (!before.exists && after.exists) return 'create';
  if (before.exists && !after.exists) return 'delete';
  return 'edit';
}

async function writeTempSnapshot(dir, name, snapshot) {
  const filePath = path.join(dir, name);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, snapshot.content);
  return filePath;
}

async function buildPatchForFile(root, relativePath, before, after) {
  if (before.exists === after.exists && before.hash === after.hash) return '';
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-oplog-'));
  try {
    const oldPath = normalizePath(path.posix.join('old', relativePath));
    const newPath = normalizePath(path.posix.join('new', relativePath));
    const beforePath = await writeTempSnapshot(tmp, oldPath, before.exists ? before : { content: Buffer.alloc(0) });
    const afterPath = await writeTempSnapshot(tmp, newPath, after.exists ? after : { content: Buffer.alloc(0) });
    const result = await runGit([
      'diff',
      '--no-index',
      '--no-color',
      '--binary',
      oldPath,
      newPath
    ], { cwd: tmp, allowFailure: true, timeoutMs: 120_000 });
    if (result.code !== 1) return '';
    const escaped = relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let patch = result.stdout
      .replace(new RegExp(`diff --git a/old/${escaped} b/new/${escaped}`), `diff --git a/${relativePath} b/${relativePath}`)
      .replace(new RegExp(`--- a/old/${escaped}`), before.exists ? `--- a/${relativePath}` : '--- /dev/null')
      .replace(new RegExp(`\\+\\+\\+ b/new/${escaped}`), after.exists ? `+++ b/${relativePath}` : '+++ /dev/null');
    if (!before.exists && after.exists && !/^new file mode /m.test(patch)) {
      patch = patch.replace(
        new RegExp(`^(diff --git a/${escaped} b/${escaped})$`, 'm'),
        `$1\nnew file mode 100644`
      );
    }
    if (before.exists && !after.exists && !/^deleted file mode /m.test(patch)) {
      patch = patch.replace(
        new RegExp(`^(diff --git a/${escaped} b/${escaped})$`, 'm'),
        `$1\ndeleted file mode 100644`
      );
    }
    return ensurePatchNewline(patch);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

export async function createGitOplogChangeTracker({ workspaceRoot = process.cwd(), sessionId } = {}) {
  const startRoot = path.resolve(workspaceRoot);
  const id = String(sessionId || '').trim();
  if (!id) return { enabled: false, reason: 'missing-session' };

  try {
    const inside = await runGit(['rev-parse', '--is-inside-work-tree'], { cwd: startRoot, allowFailure: true });
    if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
      return { enabled: false, reason: 'not-git-repo', workspaceRoot: startRoot };
    }
    const root = path.resolve((await runGit(['rev-parse', '--show-toplevel'], { cwd: startRoot })).stdout.trim());
    const head = await runGit(['rev-parse', '--verify', 'HEAD'], { cwd: root, allowFailure: true });
    const hasHead = head.code === 0;
    const gitPath = (await runGit(['rev-parse', '--git-path', `codemini/sessions/${id}`], { cwd: root })).stdout.trim();
    const oplogDir = path.resolve(root, gitPath);
    const patchesDir = path.join(oplogDir, 'patches');
    const opsDir = path.join(oplogDir, 'ops');
    await fs.mkdir(patchesDir, { recursive: true });
    await fs.mkdir(opsDir, { recursive: true });
    if (hasHead) {
      await runGit(['update-ref', `refs/codemini/sessions/${id}`, 'HEAD'], { cwd: root, allowFailure: true });
    }
    return {
      enabled: true,
      mode: 'git-oplog',
      workspaceRoot: root,
      sessionId: id,
      baseCommit: hasHead ? head.stdout.trim() : '',
      oplogDir,
      patchesDir,
      opsDir
    };
  } catch (error) {
    return { enabled: false, reason: error instanceof Error ? error.message : String(error), workspaceRoot: startRoot };
  }
}

export function isGitOplogChangeTrackerAvailable(tracker) {
  return Boolean(tracker?.enabled && tracker.mode === 'git-oplog');
}

export async function beginGitOplogCapture(tracker, { toolName = '', args = {} } = {}) {
  if (!isGitOplogChangeTrackerAvailable(tracker)) return null;
  const explicitPaths = FILE_TOOLS.has(String(toolName || '')) ? extractPathCandidates(args, [], { root: tracker.workspaceRoot }) : [];
  const status = await runGit(['status', '--porcelain=v1', '-z'], { cwd: tracker.workspaceRoot, allowFailure: true });
  const dirtyPaths = parseStatusPaths(status.stdout);
  const paths = explicitPaths.length ? explicitPaths : dirtyPaths;
  const snapshots = new Map();
  for (const filePath of paths) {
    snapshots.set(filePath, await readWorktreeSnapshot(tracker.workspaceRoot, filePath));
  }
  return {
    toolName,
    explicit: explicitPaths.length > 0,
    beforeDirtyPaths: dirtyPaths,
    paths,
    snapshots
  };
}

export async function captureGitOplogChanges(tracker, capture, { toolName = '', toolCallId = '', summary = '', args = {}, declaredFileChanges = [] } = {}) {
  if (!isGitOplogChangeTrackerAvailable(tracker) || !capture) return null;
  const afterStatus = await runGit(['status', '--porcelain=v1', '-z'], { cwd: tracker.workspaceRoot, allowFailure: true });
  const afterDirtyPaths = parseStatusPaths(afterStatus.stdout);
  const declaredPaths = extractPathCandidates(args, declaredFileChanges, { root: tracker.workspaceRoot });
  const candidates = new Set([
    ...capture.paths,
    ...declaredPaths,
    ...(capture.explicit ? [] : capture.beforeDirtyPaths),
    ...(capture.explicit ? [] : afterDirtyPaths)
  ]);

  const files = [];
  const patches = [];
  for (const filePath of candidates) {
    const normalized = normalizeRelativePath(filePath, { root: tracker.workspaceRoot });
    if (!normalized) continue;
    let before = capture.snapshots.get(normalized);
    if (!before) before = await readHeadSnapshot(tracker.workspaceRoot, normalized);
    const after = await readWorktreeSnapshot(tracker.workspaceRoot, normalized);
    const patch = await buildPatchForFile(tracker.workspaceRoot, normalized, before, after);
    if (!patch.trim()) continue;
    const stats = countPatchLines(patch);
    files.push({
      path: normalized,
      action: actionFromSnapshots(before, after),
      linesAdded: stats.added,
      linesRemoved: stats.removed,
      changedLine: firstChangedLineFromPatch(patch),
      diffPreview: patch
    });
    patches.push(patch);
  }
  if (!files.length) return null;

  const opId = changeId('op');
  const patch = patches.join('\n');
  const patchPath = path.join(tracker.patchesDir, `${opId}.patch`);
  await fs.writeFile(patchPath, patch, 'utf8');
  const op = {
    version: CHANGE_OPLOG_VERSION,
    id: opId,
    sessionId: tracker.sessionId,
    createdAt: new Date().toISOString(),
    toolName,
    toolCallId,
    summary,
    patchPath,
    files: files.map(({ diffPreview, ...file }) => file),
    revertedAt: null
  };
  saveChangeOperationToSqlite(tracker.workspaceRoot, op);
  return files.map((file) => ({
    ...file,
    changeSetId: opId,
    files: [{ path: file.path, action: file.action, linesAdded: file.linesAdded, linesRemoved: file.linesRemoved }]
  }));
}

export async function listGitOplogChanges(tracker) {
  if (!isGitOplogChangeTrackerAvailable(tracker)) return [];
  const stored = listChangeOperationsFromSqlite(tracker.workspaceRoot, tracker.sessionId);
  let entries = [];
  try {
    entries = await fs.readdir(tracker.opsDir, { withFileTypes: true });
  } catch {
    return stored;
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const legacy = await readJson(path.join(tracker.opsDir, entry.name));
      saveChangeOperationToSqlite(tracker.workspaceRoot, legacy);
      if (!stored.some((operation) => operation.id === legacy.id)) out.push(legacy);
    } catch {}
  }
  out.push(...stored);
  out.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return out;
}

export async function readGitOplogChange(tracker, opId) {
  if (!isGitOplogChangeTrackerAvailable(tracker)) throw new Error('Git change oplog is not available for this session');
  const id = String(opId || '').trim();
  if (!id) throw new Error('Missing change id');
  const stored = loadChangeOperationFromSqlite(tracker.workspaceRoot, id);
  if (stored) return stored;
  const legacy = await readJson(path.join(tracker.opsDir, `${id}.json`));
  saveChangeOperationToSqlite(tracker.workspaceRoot, legacy);
  return legacy;
}

export async function readGitOplogPatch(tracker, opId) {
  const op = await readGitOplogChange(tracker, opId);
  return fs.readFile(op.patchPath, 'utf8');
}

export async function undoGitOplogChange(tracker, opId) {
  if (!isGitOplogChangeTrackerAvailable(tracker)) throw new Error('Git change oplog is not available for this session');
  const op = await readGitOplogChange(tracker, opId);
  if (op.revertedAt) {
    return { ok: false, alreadyReverted: true, changeSetId: op.id, message: 'Change already reverted' };
  }
  const patch = await fs.readFile(op.patchPath, 'utf8');
  try {
    await runGit(['apply', '-R', '--check', '--whitespace=nowarn'], {
      cwd: tracker.workspaceRoot,
      input: patch,
      timeoutMs: 120_000
    });
  } catch (error) {
    throw new Error(`Cannot undo this change cleanly because newer edits conflict with it. Undo newer changes first, or revert it manually. ${error?.message || ''}`.trim());
  }
  await runGit(['apply', '-R', '--whitespace=nowarn'], {
    cwd: tracker.workspaceRoot,
    input: patch,
    timeoutMs: 120_000
  });
  op.revertedAt = new Date().toISOString();
  saveChangeOperationToSqlite(tracker.workspaceRoot, op);
  return { ok: true, changeSetId: op.id };
}

export async function undoGitOplogChanges(tracker, opIds = []) {
  if (!isGitOplogChangeTrackerAvailable(tracker)) throw new Error('Git change oplog is not available for this session');
  const ids = [];
  const seen = new Set();
  for (const rawId of Array.isArray(opIds) ? opIds : [opIds]) {
    const id = String(rawId || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (!ids.length) throw new Error('Missing change ids');
  if (ids.length === 1) return undoGitOplogChange(tracker, ids[0]);

  const ops = await Promise.all(ids.map((id) => readGitOplogChange(tracker, id)));
  const reverted = ops.find((op) => op.revertedAt);
  if (reverted) {
    return { ok: false, alreadyReverted: true, changeSetId: reverted.id, message: 'Change already reverted' };
  }

  const order = new Map(ids.map((id, index) => [id, index]));
  ops.sort((a, b) => {
    const byTime = String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    if (byTime) return byTime;
    return (order.get(b.id) ?? 0) - (order.get(a.id) ?? 0);
  });

  const patches = await Promise.all(ops.map(async (op) => ({
    op,
    patch: await fs.readFile(op.patchPath, 'utf8')
  })));
  if (!patches.some((item) => String(item.patch || '').trim())) throw new Error('Missing change patch');

  const applied = [];
  try {
    for (const item of patches) {
      if (!String(item.patch || '').trim()) continue;
      await runGit(['apply', '-R', '--check', '--whitespace=nowarn'], {
        cwd: tracker.workspaceRoot,
        input: item.patch,
        timeoutMs: 120_000
      });
      await runGit(['apply', '-R', '--whitespace=nowarn'], {
        cwd: tracker.workspaceRoot,
        input: item.patch,
        timeoutMs: 120_000
      });
      applied.push(item);
    }
  } catch (error) {
    for (const item of applied.reverse()) {
      await runGit(['apply', '--whitespace=nowarn'], {
        cwd: tracker.workspaceRoot,
        input: item.patch,
        allowFailure: true,
        timeoutMs: 120_000
      });
    }
    throw new Error(`Cannot undo this change cleanly because newer edits conflict with it. Undo newer changes first, or revert it manually. ${error?.message || ''}`.trim());
  }

  const revertedAt = new Date().toISOString();
  for (const op of ops) {
    op.revertedAt = revertedAt;
    saveChangeOperationToSqlite(tracker.workspaceRoot, op);
  }
  return { ok: true, changeSetIds: ops.map((op) => op.id) };
}
