import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const SKILL_DROP_MAX_FILES = 4000;
export const SKILL_DROP_MAX_BYTES = 32 * 1024 * 1024;
const DROP_PREFIX = 'codemini-skill-drop-';
const DROP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const READ_LIMIT_BYTES = 56 * 1024 * 1024;

function folderError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function safeRelativeSkillPath(input) {
  const raw = String(input || '').replace(/\\/gu, '/').replace(/^\/+/u, '');
  if (!raw || raw.includes('\0') || raw.length > 240) {
    throw folderError('INVALID_FOLDER', 'Folder contains an unsafe path.');
  }
  const parts = [];
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue;
    if (
      part === '..' ||
      part.includes('\0') ||
      /^[a-z]:/iu.test(part) ||
      path.win32.isAbsolute(part) ||
      path.posix.isAbsolute(part)
    ) {
      throw folderError('INVALID_FOLDER', 'Folder contains an unsafe path.');
    }
    parts.push(part);
  }
  if (parts.length === 0) throw folderError('INVALID_FOLDER', 'Folder contains an unsafe path.');
  return parts.join('/');
}

async function pruneOldDrops(tmpdir, now) {
  let names = [];
  try {
    names = await fs.readdir(tmpdir);
  } catch {
    return;
  }
  await Promise.all(names.map(async (name) => {
    if (!name.startsWith(DROP_PREFIX)) return;
    const full = path.join(tmpdir, name);
    try {
      const stat = await fs.stat(full);
      if (now - stat.mtimeMs > DROP_MAX_AGE_MS) {
        await fs.rm(full, { recursive: true, force: true });
      }
    } catch {
      // A locked temp directory can wait for the next prune.
    }
  }));
}

export async function stageSkillFolder(files, {
  tmpdir = os.tmpdir(),
  now = Date.now(),
} = {}) {
  if (!Array.isArray(files) || files.length === 0) {
    throw folderError('FOLDER_EMPTY', 'Folder is empty.');
  }
  if (files.length > SKILL_DROP_MAX_FILES) {
    throw folderError('FOLDER_TOO_LARGE', 'Folder has too many files.');
  }
  await pruneOldDrops(tmpdir, now);
  const root = await fs.mkdtemp(path.join(tmpdir, DROP_PREFIX));
  let total = 0;
  try {
    for (const file of files) {
      const rel = safeRelativeSkillPath(file?.path);
      const data = Buffer.from(String(file?.data || ''), 'base64');
      total += data.length;
      if (total > SKILL_DROP_MAX_BYTES) {
        throw folderError('FOLDER_TOO_LARGE', 'Folder is too large.');
      }
      const target = path.resolve(root, ...rel.split('/'));
      const rootResolved = path.resolve(root);
      if (target !== rootResolved && !target.startsWith(`${rootResolved}${path.sep}`)) {
        throw folderError('INVALID_FOLDER', 'Folder path escapes the destination.');
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, data);
    }
    return { path: root, fileCount: files.length };
  } catch (error) {
    await fs.rm(root, { recursive: true, force: true });
    throw error;
  }
}

export function readLimitedJson(req, maxBytes = READ_LIMIT_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        finish(reject, folderError('FOLDER_TOO_LARGE', 'Folder is too large.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        finish(resolve, text ? JSON.parse(text) : {});
      } catch {
        finish(reject, folderError('INVALID_FOLDER', 'Folder payload is not valid JSON.'));
      }
    });
    req.on('error', (error) => finish(reject, error));
  });
}
