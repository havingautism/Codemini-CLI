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
const INSTALL_COMMAND_PATTERNS = [
  /\b(?:npm|pnpm|yarn|bun)\s+install\b/i,
  /\b(?:npm|pnpm|yarn|bun)\s+(?:ci|i|add)\b/i,
  /\buv\s+pip\s+install\b/i,
  /\bpip\s+install\b/i,
  /\bcargo\s+install\b/i,
  /\bbundle\s+install\b/i,
  /\bcomposer\s+install\b/i
];
const BUILD_COMMAND_RE = /\b(?:build|compile|bundle|pack|transpile)\b/i;
const TEST_COMMAND_PATTERNS = [
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|lint|check|typecheck)\b/i,
  /\b(?:jest|vitest|mocha|ava|pytest|go\s+test|cargo\s+test|dotnet\s+test)\b/i
];
const FRONTEND_SERVICE_PATTERNS = [
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
const BACKEND_SERVICE_PATTERNS = [
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
const DATABASE_SERVICE_PATTERNS = [
  /\bpostgres(?:ql)?\b/i,
  /\bmysql\b/i,
  /\bmariadb\b/i,
  /\bmongod\b/i,
  /\bredis-server\b/i,
  /\b(?:docker|docker-compose|docker compose)\s+.*\b(?:db|database|postgres|mysql|mongo|redis)\b/i,
  /\b(?:db|database|postgres|mysql|mongo|redis)\b.*\b(?:start|up|serve|run)\b/i
];
const DOCKER_SERVICE_PATTERNS = [
  /\bdocker\s+compose\s+up\b/i,
  /\bdocker-compose\s+up\b/i,
  /\bdocker\s+run\b/i,
  /\bdocker\s+start\b/i
];
const PACKAGE_SERVICE_RE = /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|preview|watch)\b/i;
const VITE_OR_SERVE_RE = /\b(?:vite|serve)\b/i;
const SERVICE_HINT_RE = /\b(?:watch|serve|server|dev|preview)\b/i;
const AUTO_STOP_GRACE_MS = 150;
const MAX_BUFFERED_OUTPUT = 8 * 1024 * 1024;
const OUTPUT_TRUNCATION_MARKER = '\n...[output truncated at 8MB]...\n';
const READY_OUTPUT_WINDOW_CHARS = 64_000;

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

  if (matchesAny(value, INSTALL_COMMAND_PATTERNS)) {
    return { kind: 'install', longRunning: false };
  }

  if (BUILD_COMMAND_RE.test(value)) {
    return { kind: 'build', longRunning: false };
  }

  if (matchesAny(value, TEST_COMMAND_PATTERNS)) {
    return { kind: 'test', longRunning: false };
  }

  if (matchesAny(value, FRONTEND_SERVICE_PATTERNS)) {
    return { kind: 'frontend-service', longRunning: true };
  }

  if (matchesAny(value, BACKEND_SERVICE_PATTERNS)) {
    return { kind: 'backend-service', longRunning: true };
  }

  if (matchesAny(value, DATABASE_SERVICE_PATTERNS)) {
    return { kind: 'database-service', longRunning: true };
  }

  if (matchesAny(value, DOCKER_SERVICE_PATTERNS)) {
    return { kind: 'docker-service', longRunning: true };
  }

  if (
    PACKAGE_SERVICE_RE.test(value) ||
    VITE_OR_SERVE_RE.test(value) ||
    SERVICE_HINT_RE.test(value)
  ) {
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

function appendOutputWithCap(current, chunk, state) {
  if (state.truncated) return current;
  const text = chunk.toString();
  const combined = current + text;
  if (combined.length <= MAX_BUFFERED_OUTPUT) return combined;
  const headLength = Math.floor(MAX_BUFFERED_OUTPUT * 0.6);
  const tailLength = MAX_BUFFERED_OUTPUT - headLength - OUTPUT_TRUNCATION_MARKER.length;
  state.truncated = true;
  return (
    combined.slice(0, headLength) +
    OUTPUT_TRUNCATION_MARKER +
    combined.slice(combined.length - tailLength)
  );
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
  if (child.sandboxProcess) {
    child.kill(signal);
    return;
  }
  const pid = Number(child.pid);
  if (process.platform === 'win32' && Number.isInteger(pid) && pid > 0) {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
    } catch {}
    return;
  }
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

export function resolveSandboxShell(defaultShell) {
  if (String(defaultShell || '').toLowerCase() === 'powershell') return 'pwsh';
  return 'bash';
}

export function isDangerousCommand(command, blockedPatterns = []) {
  const lowered = command.toLowerCase();
  return blockedPatterns.some((pattern) => lowered.includes(String(pattern).toLowerCase()));
}

function spawnShellChild({ shellSpec, shellCommand, cwd }) {
  return spawn(shellSpec.command, [...shellSpec.args, shellCommand], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export async function runShellCommand({
  command,
  cwd = process.cwd(),
  shell = 'bash',
  timeoutMs = 1800000,
  signal,
  config,
  sandboxMode,
}) {
  if (signal?.aborted) {
    return Promise.reject(Object.assign(new Error('Command aborted before dispatch'), { code: 'ABORT_ERR' }));
  }
  const shellSpec = resolveShell(shell);
  const shellCommand =
    process.platform !== 'win32' && /(?:^|\/)bash(?:\.exe)?$/i.test(shellSpec.command)
      ? `exec ${command}`
      : command;

  let sandboxChild = null;
  let sandboxMeta = { wrapped: false, mode: '', backend: 'none' };
  let annotateStderr = null;
  if (config) {
    const { prepareSandboxExecution, spawnPreparedSandbox } = await import('./sandbox-backend.js');
    const prepared = await prepareSandboxExecution({
      command: String(command || ''),
      config,
      cwd,
      mode: sandboxMode,
      binShell: resolveSandboxShell(shell),
      abortSignal: signal,
    });
    if (prepared.kind === 'os') {
      const os = await import('./sandbox-os.js');
      annotateStderr = os.annotateSandboxStderrAsync;
    }
    if (prepared.wrapped) {
      sandboxChild = spawnPreparedSandbox({
        prepared,
        shellSpec,
        shellCommand,
        cwd,
      });
      sandboxMeta = {
        wrapped: true,
        mode: prepared.policy?.mode || '',
        backend: prepared.policy?.backend || prepared.kind,
      };
    }
  }

  return new Promise((resolve, reject) => {
    const child = sandboxChild || spawnShellChild({ shellSpec, shellCommand, cwd });

    let stdout = '';
    let stderr = '';
    let stdoutReadyWindow = '';
    let stderrReadyWindow = '';
    const stdoutState = { truncated: false };
    const stderrState = { truncated: false };
    let timedOut = false;
    let autoStopped = false;
    let aborted = false;
    let stopReason = '';
    let finalized = false;
    let killTimer = null;
    const longRunningCommand = isLikelyLongRunningCommand(command);
    const autoStopWindowMs = longRunningCommand
      ? Math.min(30_000, Math.max(5_000, Math.floor(timeoutMs * 0.6)))
      : 0;

    const withSandboxFields = (value) => {
      if (!sandboxMeta.wrapped) return value;
      return {
        ...value,
        sandbox: {
          mode: sandboxMeta.mode,
          wrapped: true,
        },
      };
    };

    const finalizeResolve = async (value) => {
      if (finalized) return;
      finalized = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      if (autoStopTimer) clearTimeout(autoStopTimer);
      signal?.removeEventListener('abort', abortCommand);
      let next = withSandboxFields(value);
      if (sandboxMeta.backend === 'os' && typeof annotateStderr === 'function') {
        try {
          next = {
            ...next,
            stderr: await annotateStderr(String(command || ''), next.stderr || ''),
          };
        } catch {}
      }
      if (
        sandboxMeta.wrapped &&
        next.code &&
        next.code !== 0 &&
        /operation not permitted|read-only file system|permission denied|sandbox/i.test(
          String(next.stderr || ''),
        )
      ) {
        next.sandbox = {
          ...(next.sandbox || {}),
          denied: true,
        };
        const marker = `[sandbox: file access denied under ${sandboxMeta.mode || 'unknown'} mode]`;
        if (!String(next.stderr || '').includes('[sandbox:')) {
          next.stderr = `${next.stderr || ''}${next.stderr ? '\n' : ''}${marker}`;
        }
      }
      resolve(next);
    };

    const finalizeReject = (error) => {
      if (finalized) return;
      finalized = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      if (autoStopTimer) clearTimeout(autoStopTimer);
      signal?.removeEventListener('abort', abortCommand);
      reject(error);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      terminateChild(child, 'SIGTERM');
      killTimer = setTimeout(() => terminateChild(child, 'SIGKILL'), AUTO_STOP_GRACE_MS);
    }, timeoutMs);
    const autoStopTimer =
      autoStopWindowMs > 0
        ? setTimeout(() => {
            finalizeAutoStop('startup_window');
          }, autoStopWindowMs)
        : null;

    const abortCommand = () => {
      if (finalized || aborted) return;
      aborted = true;
      terminateChild(child, 'SIGTERM');
      killTimer = setTimeout(() => terminateChild(child, 'SIGKILL'), AUTO_STOP_GRACE_MS);
    };
    signal?.addEventListener('abort', abortCommand, { once: true });
    if (signal?.aborted) abortCommand();

    const autoStopPayload = () => ({
      code: stopReason === 'startup_window' ? 124 : 0,
      stdout,
      stderr,
      auto_stopped: true,
      stop_reason: stopReason,
    });

    const finalizeAutoStop = (reason) => {
      if (timedOut || autoStopped || finalized) return;
      autoStopped = true;
      stopReason = reason;
      if (reason === 'startup_window') {
        stderr +=
          '\n[auto-stopped: no ready output within startup window — the command may still be starting; rerun in background if it is a long-running server]';
      }
      terminateChild(child, 'SIGTERM');
      setTimeout(() => {
        terminateChild(child, 'SIGKILL');
      }, AUTO_STOP_GRACE_MS);
      void finalizeResolve(autoStopPayload());
    };

    child.stdout.on('data', (chunk) => {
      stdout = appendOutputWithCap(stdout, chunk, stdoutState);
      stdoutReadyWindow = (stdoutReadyWindow + chunk.toString()).slice(-READY_OUTPUT_WINDOW_CHARS);
      if (longRunningCommand && hasReadyOutput(stdoutReadyWindow)) {
        finalizeAutoStop('ready_output');
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr = appendOutputWithCap(stderr, chunk, stderrState);
      stderrReadyWindow = (stderrReadyWindow + chunk.toString()).slice(-READY_OUTPUT_WINDOW_CHARS);
      if (longRunningCommand && hasReadyOutput(stderrReadyWindow)) {
        finalizeAutoStop('ready_output');
      }
    });

    child.on('error', (err) => {
      finalizeReject(err);
    });

    child.on('close', (code) => {
      if (finalized) return;
      if (aborted) {
        finalizeReject(Object.assign(new Error('Command aborted'), { code: 'ABORT_ERR' }));
        return;
      }
      if (timedOut) {
        finalizeReject(new Error(`Command timed out after ${timeoutMs}ms`));
        return;
      }
      if (autoStopped) {
        void finalizeResolve(autoStopPayload());
        return;
      }
      void finalizeResolve({ code, stdout, stderr });
    });
  });
}
