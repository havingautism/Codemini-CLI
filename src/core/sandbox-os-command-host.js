// A private OS sandbox manager per reviewed network command. SRT's network
// proxies use process-global policy, so sharing a manager would leak grants.
import { spawn } from 'node:child_process';
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';
import { resolveShell } from './shell.js';

const input = JSON.parse(process.argv[2]);
let child;
let stopped = false;
let killTimer;
function terminate(signal = 'SIGTERM') {
  stopped = true;
  if (child?.pid) {
    try { process.kill(-child.pid, signal); } catch { child.kill(signal); }
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  terminate(signal);
  killTimer = setTimeout(() => terminate('SIGKILL'), 1000);
});
try {
  await SandboxManager.initialize(input.runtimeConfig, async () => !stopped);
  if (stopped) throw new Error('Command stopped before dispatch');
  const command = await SandboxManager.wrapWithSandbox(input.command, input.binShell, input.runtimeConfig);
  if (stopped) throw new Error('Command stopped before dispatch');
  const shell = resolveShell(input.binShell === 'pwsh' ? 'powershell' : 'bash');
  child = spawn(shell.command, [...shell.args, command], { stdio: 'inherit', detached: true });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
  process.exitCode = code;
} catch (error) {
  console.error(`[sandbox: ${error.message || error}]`);
  process.exitCode = 1;
} finally {
  clearTimeout(killTimer);
  terminate('SIGKILL');
  await SandboxManager.reset().catch(() => {});
}
