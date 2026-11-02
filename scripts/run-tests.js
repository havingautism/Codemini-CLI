import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Restoring process.env in an individual test must never expose real user state.
const base = path.resolve(os.tmpdir());
const globalDir = await fs.mkdtemp(path.join(base, 'codemini-tests-global-'));
const args = process.argv.slice(2);
const child = spawn(process.execPath, ['--test', ...(args.length ? args : ['tests/*.test.js'])], {
  stdio: 'inherit',
  env: { ...process.env, CODEMINI_GLOBAL_DIR: globalDir },
});
const code = await new Promise((resolve) => {
  child.once('error', (error) => { console.error(error.message); resolve(1); });
  child.once('exit', (exitCode) => resolve(exitCode ?? 1));
});
// Only remove the exact isolated directory created by this run.
if (path.dirname(path.resolve(globalDir)) !== base) throw new Error('Invalid test directory');
await fs.rm(globalDir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
process.exitCode = code;
