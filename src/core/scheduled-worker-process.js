import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { getBaseConfigDir } from './paths.js';
import { hasScheduledWork, scheduledWorkerStatus } from './scheduled-task-store.js';

export async function startScheduledWorker() {
  const status = scheduledWorkerStatus();
  if (status.running || !hasScheduledWork()) return status;
  const directory = getBaseConfigDir();
  fs.mkdirSync(directory, { recursive: true });
  const log = fs.openSync(path.join(directory, 'scheduled-worker.log'), 'a');
  try {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./scheduled-worker.js', import.meta.url))], {
      detached: true, windowsHide: true, cwd: directory,
      env: { ...process.env }, stdio: ['ignore', log, log],
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    return { running: false, starting: true, pid: child.pid };
  } finally {
    fs.closeSync(log);
  }
}
