import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

function isPathInside(parentDir, candidatePath) {
  const relative = path.relative(path.resolve(parentDir), path.resolve(candidatePath));
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

export function fileLaunchCommand(targetPath, {
  action = 'open',
  isDirectory = false,
  platform = process.platform,
} = {}) {
  const reveal = action === 'reveal' && !isDirectory;
  if (platform === 'win32') {
    if (reveal) {
      return {
        command: 'explorer.exe',
        args: [`/select,"${targetPath}"`],
        options: { windowsVerbatimArguments: true },
      };
    }
    return {
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Start-Process -FilePath $env:CODEMINI_OPEN_TARGET',
      ],
      options: {
        env: { ...process.env, CODEMINI_OPEN_TARGET: targetPath },
        windowsHide: true,
      },
    };
  }
  if (platform === 'darwin') {
    return {
      command: 'open',
      args: reveal ? ['-R', targetPath] : [targetPath],
      options: {},
    };
  }
  return {
    command: 'xdg-open',
    args: [reveal ? path.dirname(targetPath) : targetPath],
    options: {},
  };
}

export async function launchWorkspacePath(
  rawPath,
  workspaceRoot = process.cwd(),
  {
    action = 'open',
    spawnProcess = spawn,
    platform = process.platform,
  } = {},
) {
  const requestedAction = String(action || 'open').toLowerCase();
  if (!['open', 'reveal'].includes(requestedAction)) {
    throw new Error('Invalid file action');
  }
  const input = String(rawPath || '').trim();
  if (!input) throw new Error('Missing file path');

  const root = await fs.realpath(path.resolve(workspaceRoot));
  const candidate = path.resolve(root, input);
  if (!isPathInside(root, candidate)) throw new Error('File path is outside the current project');

  const target = await fs.realpath(candidate).catch((error) => {
    if (error?.code === 'ENOENT') throw new Error('File does not exist');
    throw error;
  });
  if (!isPathInside(root, target)) throw new Error('File path is outside the current project');

  const stat = await fs.stat(target);
  if (!stat.isFile() && !stat.isDirectory()) {
    throw new Error('Target is not a file or directory');
  }

  const launcher = fileLaunchCommand(target, {
    action: requestedAction,
    isDirectory: stat.isDirectory(),
    platform,
  });
  const child = spawnProcess(launcher.command, launcher.args, {
    detached: platform !== 'win32',
    stdio: 'ignore',
    ...launcher.options,
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
  return {
    ok: true,
    action: requestedAction,
    path: target,
    isDirectory: stat.isDirectory(),
  };
}
