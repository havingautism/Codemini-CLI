import { spawn } from 'node:child_process';

function resolveShell(defaultShell) {
  if (process.platform === 'win32') {
    if (defaultShell === 'cmd') {
      return { command: 'cmd.exe', args: ['/d', '/s', '/c'] };
    }
    if (defaultShell === 'bash') {
      return { command: 'bash.exe', args: ['-lc'] };
    }
    return { command: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-Command'] };
  }

  if (defaultShell === 'powershell') {
    return { command: 'pwsh', args: ['-NoLogo', '-NoProfile', '-Command'] };
  }

  return { command: '/bin/bash', args: ['-lc'] };
}

export function isDangerousCommand(command, blockedPatterns = []) {
  const lowered = command.toLowerCase();
  return blockedPatterns.some((pattern) => lowered.includes(String(pattern).toLowerCase()));
}

export function runShellCommand({
  command,
  cwd = process.cwd(),
  shell = 'powershell',
  timeoutMs = 120000
}) {
  const shellSpec = resolveShell(shell);

  return new Promise((resolve, reject) => {
    const child = spawn(shellSpec.command, [...shellSpec.args, command], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`Command timed out after ${timeoutMs}ms`));
        return;
      }
      resolve({ code, stdout, stderr });
    });
  });
}
