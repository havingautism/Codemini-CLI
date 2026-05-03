import { spawn, spawnSync } from 'node:child_process';

const LONG_RUNNING_COMMAND_RE =
  /\b(npm\s+(?:run\s+)?(?:start|dev)\b|pnpm\s+(?:run\s+)?(?:start|dev)\b|yarn\s+(?:start|dev)\b|vite\b|next\s+dev\b|webpack\s+serve\b|python\s+-m\s+http\.server\b|serve\b|java\s+-jar\b|mvn(?:w)?\s+spring-boot:run\b|gradle(?:w)?\s+bootRun\b|gradle(?:w)?\s+run\b|java\b.*\bserver\b|dotnet\s+run\b|go\s+run\b.*\b(server|cmd\/server|main\.go)\b|air\b|cargo\s+run\b.*\b(server|api|web)\b|cargo\s+watch\s+-x\s+run\b)/i;
const GENERIC_LONG_RUNNING_HINT_RE = /\b(start|serve|server|dev|preview|watch)\b/i;
const READY_OUTPUT_PATTERNS = [
  /\bready\b/i,
  /\bcompiled successfully\b/i,
  /\blocal:\s*https?:\/\//i,
  /\blistening on\b/i,
  /\bserver running\b/i,
  /\brunning at\b/i,
  /\bserving at\b/i,
  /\bstarted\b.*\bin\b/i,
  /\bstarted\s+[A-Za-z0-9_$.-]+\s+in\b/i,
  /\btomcat started on port\(s\):/i,
  /\bnetty started on port/i,
  /\bnow listening on:\s*https?:\/\//i,
  /\bapplication started\./i,
  /\bserving http on\b/i,
  /\bstarting development server at\b/i,
  /\bactix web server running on\b/i,
  /\bhttp:\/\/127\.0\.0\.1\b/i,
  /\bhttp:\/\/localhost\b/i
];
const AUTO_STOP_GRACE_MS = 150;
const LONG_RUNNING_STARTUP_WINDOW_MS = 1500;

function normalizeCommand(command) {
  return String(command || '').trim();
}

function matchesAny(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}

export function classifyCommandIntent(command) {
  const value = normalizeCommand(command);

  if (!value) {
    return { kind: 'generic', longRunning: false };
  }

  if (
    /\b(?:npm|pnpm|yarn|bun)\s+install\b/i.test(value) ||
    /\b(?:npm|pnpm|yarn|bun)\s+(?:ci|i|add)\b/i.test(value) ||
    /\buv\s+pip\s+install\b/i.test(value) ||
    /\bpip\s+install\b/i.test(value) ||
    /\bcargo\s+install\b/i.test(value) ||
    /\bbundle\s+install\b/i.test(value) ||
    /\bcomposer\s+install\b/i.test(value)
  ) {
    return { kind: 'install', longRunning: false };
  }

  if (/\b(?:build|compile|bundle|pack|transpile)\b/i.test(value)) {
    return { kind: 'build', longRunning: false };
  }

  if (
    /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|lint|check|typecheck)\b/i.test(value) ||
    /\b(?:jest|vitest|mocha|ava|pytest|go\s+test|cargo\s+test|dotnet\s+test)\b/i.test(value)
  ) {
    return { kind: 'test', longRunning: false };
  }

  const frontendServicePatterns = [
    /\bvite\b/i,
    /\bnext\s+dev\b/i,
    /\bnuxt\s+dev\b/i,
    /\bastro\s+dev\b/i,
    /\bremix\s+dev\b/i,
    /\bsvelte-kit\s+dev\b/i,
    /\bwebpack\s+serve\b/i,
    /\bvue-cli-service\s+serve\b/i,
    /\breact-scripts\s+start\b/i,
    /\bstorybook\b/i,
    /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|preview)\b.*\b(?:client|frontend|front-end|web|ui)\b/i,
    /\b(?:client|frontend|front-end|web|ui)\b.*\b(?:dev|start|serve|preview)\b/i
  ];
  if (matchesAny(value, frontendServicePatterns)) {
    return { kind: 'frontend-service', longRunning: true };
  }

  const backendServicePatterns = [
    /\bpython\s+-m\s+http\.server\b/i,
    /\buvicorn\b/i,
    /\bgunicorn\b/i,
    /\bflask\s+run\b/i,
    /\bdjango\s+runserver\b/i,
    /\brails\s+(?:s|server)\b/i,
    /\bmvn(?:w)?\s+spring-boot:run\b/i,
    /\bgradle(?:w)?\s+bootRun\b/i,
    /\bgradle(?:w)?\s+run\b/i,
    /\bjava\b.*\bserver\b/i,
    /\bdotnet\s+run\b/i,
    /\bgo\s+run\b.*\b(server|cmd\/server|main\.go)\b/i,
    /\bnest\s+start\b/i,
    /\bnodemon\b/i,
    /\bts-node-dev\b/i,
    /\bair\b/i,
    /\bphp\s+artisan\s+serve\b/i,
    /\bsymfony\s+server:start\b/i,
    /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|preview)\b.*\b(?:server|api|backend)\b/i,
    /\b(?:server|api|backend)\b.*\b(?:dev|start|serve|preview)\b/i
  ];
  if (matchesAny(value, backendServicePatterns)) {
    return { kind: 'backend-service', longRunning: true };
  }

  const databaseServicePatterns = [
    /\bpostgres(?:ql)?\b/i,
    /\bmysql\b/i,
    /\bmariadb\b/i,
    /\bmongod\b/i,
    /\bredis-server\b/i,
    /\b(?:docker|docker-compose|docker compose)\s+.*\b(?:db|database|postgres|mysql|mongo|redis)\b/i,
    /\b(?:db|database|postgres|mysql|mongo|redis)\b.*\b(?:start|up|serve|run)\b/i
  ];
  if (matchesAny(value, databaseServicePatterns)) {
    return { kind: 'database-service', longRunning: true };
  }

  const dockerServicePatterns = [
    /\bdocker\s+compose\s+up\b/i,
    /\bdocker-compose\s+up\b/i,
    /\bdocker\s+run\b/i,
    /\bdocker\s+start\b/i
  ];
  if (matchesAny(value, dockerServicePatterns)) {
    return { kind: 'docker-service', longRunning: true };
  }

  if (
    /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|preview|watch)\b/i.test(value) ||
    /\b(?:vite|serve)\b/i.test(value) ||
    /\b(?:watch|serve|server|dev|preview)\b/i.test(value)
  ) {
    return { kind: 'service', longRunning: true };
  }

  if (/\b(?:watch|serve|server|dev|preview)\b/i.test(value)) {
    return { kind: 'service', longRunning: true };
  }

  return { kind: 'generic', longRunning: false };
}

export function isLikelyLongRunningCommand(command) {
  const { longRunning } = classifyCommandIntent(command);
  return longRunning || LONG_RUNNING_COMMAND_RE.test(normalizeCommand(command)) || GENERIC_LONG_RUNNING_HINT_RE.test(normalizeCommand(command));
}

export function hasReadyOutput(text) {
  const value = String(text || '');
  return READY_OUTPUT_PATTERNS.some((pattern) => pattern.test(value));
}

function collectDescendantPids(rootPid, seen = new Set()) {
  const pid = Number(rootPid);
  if (!Number.isInteger(pid) || pid <= 0 || seen.has(pid) || process.platform === 'win32') {
    return [];
  }
  seen.add(pid);
  const result = spawnSync('ps', ['-o', 'pid=', '--ppid', String(pid)], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout) return [];
  const directChildren = result.stdout
    .split('\n')
    .map((value) => Number(String(value || '').trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
  const descendants = [];
  for (const childPid of directChildren) {
    if (seen.has(childPid)) continue;
    descendants.push(childPid);
    descendants.push(...collectDescendantPids(childPid, seen));
  }
  return descendants;
}

export function terminateChild(child, signal = 'SIGTERM') {
  if (!child) return;
  const pid = Number(child.pid);
  if (process.platform !== 'win32' && Number.isInteger(pid) && pid > 0) {
    const descendants = collectDescendantPids(pid);
    for (const targetPid of descendants.reverse()) {
      try {
        process.kill(targetPid, signal);
      } catch {}
    }
  }
  try {
    child.kill(signal);
  } catch {}
}

export function resolveShell(defaultShell) {
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
  timeoutMs = 1800000
}) {
  const shellSpec = resolveShell(shell);
  const shellCommand =
    process.platform !== 'win32' && /(?:^|\/)bash(?:\.exe)?$/i.test(shellSpec.command)
      ? `exec ${command}`
      : command;

  return new Promise((resolve, reject) => {
    const child = spawn(shellSpec.command, [...shellSpec.args, shellCommand], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let autoStopped = false;
    let stopReason = '';
    let finalized = false;
    const longRunningCommand = isLikelyLongRunningCommand(command);
    const autoStopWindowMs = longRunningCommand
      ? Math.min(LONG_RUNNING_STARTUP_WINDOW_MS, Math.max(350, Math.floor(timeoutMs * 0.6)))
      : 0;

    const finalizeResolve = (value) => {
      if (finalized) return;
      finalized = true;
      clearTimeout(timer);
      if (autoStopTimer) clearTimeout(autoStopTimer);
      resolve(value);
    };

    const finalizeReject = (error) => {
      if (finalized) return;
      finalized = true;
      clearTimeout(timer);
      if (autoStopTimer) clearTimeout(autoStopTimer);
      reject(error);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      terminateChild(child, 'SIGTERM');
    }, timeoutMs);
    const autoStopTimer =
      autoStopWindowMs > 0
        ? setTimeout(() => {
            finalizeAutoStop('startup_window');
          }, autoStopWindowMs)
        : null;

    const finalizeAutoStop = (reason) => {
      if (timedOut || autoStopped || finalized) return;
      autoStopped = true;
      stopReason = reason;
      terminateChild(child, 'SIGTERM');
      setTimeout(() => {
        terminateChild(child, 'SIGKILL');
      }, AUTO_STOP_GRACE_MS);
      finalizeResolve({ code: 0, stdout, stderr, auto_stopped: true, stop_reason: stopReason });
    };

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (longRunningCommand && hasReadyOutput(stdout)) {
        finalizeAutoStop('ready_output');
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (longRunningCommand && hasReadyOutput(stderr)) {
        finalizeAutoStop('ready_output');
      }
    });

    child.on('error', (err) => {
      finalizeReject(err);
    });

    child.on('close', (code) => {
      if (finalized) return;
      if (timedOut) {
        finalizeReject(new Error(`Command timed out after ${timeoutMs}ms`));
        return;
      }
      if (autoStopped) {
        finalizeResolve({ code: 0, stdout, stderr, auto_stopped: true, stop_reason: stopReason });
        return;
      }
      finalizeResolve({ code, stdout, stderr });
    });
  });
}
