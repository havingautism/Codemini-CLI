import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { closeSqliteDatabasesForTests } from '../../src/core/sqlite-database.js';

// ponytail: Windows WAL/SHM can stay locked after close(); retry instead of a waiter process.
async function removeDir(dir) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error?.code !== 'EBUSY' && error?.code !== 'EPERM' && error?.code !== 'ENOTEMPTY') throw error;
      closeSqliteDatabasesForTests(dir);
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
  await fs.rm(dir, { recursive: true, force: true });
}

export async function withMemoryEnv(task) {
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-memory2-'));
  process.env.CODEMINI_GLOBAL_DIR = dir;
  try {
    return await task(dir);
  } finally {
    closeSqliteDatabasesForTests(dir);
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
    await removeDir(dir);
  }
}
