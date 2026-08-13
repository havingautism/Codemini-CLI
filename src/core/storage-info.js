import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getBaseConfigDir, getProjectIndexDir } from './paths.js';

async function fileSize(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() ? stat.size : 0;
  } catch (error) {
    if (error?.code === 'ENOENT') return 0;
    throw error;
  }
}

async function describeDatabase(id, filePath, projectDir = '') {
  const [databaseBytes, walBytes, shmBytes] = await Promise.all([
    fileSize(filePath),
    fileSize(`${filePath}-wal`),
    fileSize(`${filePath}-shm`),
  ]);
  return {
    id,
    path: filePath,
    folder: path.dirname(filePath),
    exists: databaseBytes > 0,
    databaseBytes,
    walBytes,
    shmBytes,
    sizeBytes: databaseBytes + walBytes + shmBytes,
    ...(projectDir ? { projectDir } : {}),
  };
}

export async function getSqliteStorageInfo(projectDir = process.cwd()) {
  const normalizedProjectDir = path.resolve(projectDir || process.cwd());
  const globalPath = path.join(getBaseConfigDir(), 'codemini.sqlite');
  const projectPath = path.join(getProjectIndexDir(normalizedProjectDir), 'index.sqlite');
  const [global, project] = await Promise.all([
    describeDatabase('global', globalPath),
    describeDatabase('project', projectPath, normalizedProjectDir),
  ]);
  return { global, project, measuredAt: new Date().toISOString() };
}

function fileManagerCommand(folder, platform = process.platform) {
  if (platform === 'win32') {
    return { command: 'explorer.exe', args: [`/e,"${folder}"`], windowsVerbatimArguments: true };
  }
  if (platform === 'darwin') return { command: 'open', args: [folder] };
  return { command: 'xdg-open', args: [folder] };
}

export async function openSqliteStorageFolder(
  target,
  projectDir = process.cwd(),
  { spawnProcess = spawn, platform = process.platform } = {},
) {
  const storage = await getSqliteStorageInfo(projectDir);
  const selected = target === 'global' ? storage.global : target === 'project' ? storage.project : null;
  if (!selected) throw new Error('Invalid storage target');
  await fs.mkdir(selected.folder, { recursive: true });
  const launcher = fileManagerCommand(selected.folder, platform);
  const isWindows = platform === 'win32';
  const child = spawnProcess(launcher.command, launcher.args, {
    detached: !isWindows,
    stdio: 'ignore',
    windowsHide: false,
    ...(launcher.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
  return { ok: true, target, folder: selected.folder };
}
