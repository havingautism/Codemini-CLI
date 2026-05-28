import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizePath } from './string-utils.js';

function normalizeRelativePath(value) {
  const text = normalizePath(String(value || '').trim()).replace(/:\d+(?:-\d+)?$/, '');
  if (!text || text === '.' || path.isAbsolute(text) || text.startsWith('../')) return '';
  return text;
}

function safeBackupRelativePath(relativePath) {
  return normalizeRelativePath(relativePath)
    .split('/')
    .map((part) => part.replace(/[<>:"\\|?*\x00-\x1F]/g, '_'))
    .join('/');
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function createNonGitBackupManager({ workspaceRoot = process.cwd(), sessionId } = {}) {
  const root = path.resolve(workspaceRoot);
  const id = String(sessionId || '').trim();
  if (!id) return null;
  const backupRoot = path.join(root, '.codemini', 'backups', 'sessions', id);
  const filesRoot = path.join(backupRoot, 'files');
  const manifestPath = path.join(backupRoot, 'manifest.json');
  await fs.mkdir(filesRoot, { recursive: true });
  const manifest = await readJson(manifestPath, {
    version: 1,
    sessionId: id,
    createdAt: new Date().toISOString(),
    files: {}
  });

  async function backupOnce(relativePath) {
    const normalized = normalizeRelativePath(relativePath);
    if (!normalized) return { ok: false, reason: 'invalid-path' };
    const existing = manifest.files?.[normalized];
    if (existing) {
      return { ...existing, ok: true, reused: true, created: false };
    }

    const target = path.resolve(root, normalized);
    const rel = path.relative(root, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return { ok: false, path: normalized, reason: 'outside-workspace' };
    }

    let stat;
    try {
      stat = await fs.stat(target);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const entry = {
        path: normalized,
        existed: false,
        backupPath: '',
        backupRelativePath: '',
        createdAt: new Date().toISOString()
      };
      manifest.files[normalized] = entry;
      await writeJson(manifestPath, manifest);
      return { ...entry, ok: true, reused: false, created: false };
    }

    if (!stat.isFile()) {
      const entry = {
        path: normalized,
        existed: true,
        backupPath: '',
        backupRelativePath: '',
        skipped: true,
        reason: stat.isDirectory() ? 'directory' : 'not-file',
        createdAt: new Date().toISOString()
      };
      manifest.files[normalized] = entry;
      await writeJson(manifestPath, manifest);
      return { ...entry, ok: true, reused: false, created: false };
    }

    const safeRelative = safeBackupRelativePath(normalized);
    const backupPath = path.join(filesRoot, safeRelative);
    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    await fs.copyFile(target, backupPath);
    const entry = {
      path: normalized,
      existed: true,
      backupPath,
      backupRelativePath: normalizePath(path.relative(root, backupPath)),
      createdAt: new Date().toISOString()
    };
    manifest.files[normalized] = entry;
    await writeJson(manifestPath, manifest);
    return { ...entry, ok: true, reused: false, created: true };
  }

  return {
    mode: 'non-git-backup',
    workspaceRoot: root,
    sessionId: id,
    backupRoot,
    manifestPath,
    backupOnce
  };
}
