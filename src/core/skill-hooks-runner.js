import { execFile, spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_SEC = 30;
const HOOK_EXECUTION_LIMIT = 16000;

export function expandHookCommandPlaceholders(command, env = {}) {
  const merged = { ...process.env, ...env };
  const pluginRoot = merged.CODEMINI_PLUGIN_ROOT || merged.CLAUDE_PLUGIN_ROOT || '';
  const claudePluginRoot = merged.CLAUDE_PLUGIN_ROOT || pluginRoot;
  return String(command ?? '')
    .replace(/\$\{CLAUDE_PROJECT_DIR\}/g, merged.CLAUDE_PROJECT_DIR ?? '')
    .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, claudePluginRoot)
    .replace(/\$\{CODEMINI_PLUGIN_ROOT\}/g, pluginRoot);
}

function parseStdout(stdout) {
  const trimmed = String(stdout ?? '').trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function extractHookFields(parsed, eventName = '') {
  if (!parsed) {
    return {
      decision: undefined,
      reason: undefined,
      additionalContext: undefined,
      systemMessage: undefined,
      updatedInput: undefined,
      continue: undefined,
      stopReason: undefined,
    };
  }

  const hookSpecificOutput =
    parsed.hookSpecificOutput && typeof parsed.hookSpecificOutput === 'object'
      ? parsed.hookSpecificOutput
      : {};
  const isPreToolUse = eventName === 'PreToolUse';
  const structuredDecision = isPreToolUse
    ? hookSpecificOutput.permissionDecision
    : undefined;
  const structuredReason = isPreToolUse
    ? hookSpecificOutput.permissionDecisionReason
    : undefined;

  return {
    decision: structuredDecision ?? parsed.decision,
    reason: structuredReason ?? parsed.reason,
    additionalContext: hookSpecificOutput.additionalContext ?? parsed.additionalContext,
    systemMessage: parsed.systemMessage,
    updatedInput: hookSpecificOutput.updatedInput,
    continue: parsed.continue,
    stopReason: parsed.stopReason,
  };
}

function resolveDecision(exitCode, parsedDecision, eventName = '') {
  if (exitCode === 2) return 'deny';
  if (eventName === 'PreToolUse') {
    if (parsedDecision === 'block') return 'deny';
    if (parsedDecision === 'approve') return 'allow';
    if (['deny', 'allow', 'ask', 'defer'].includes(parsedDecision)) return parsedDecision;
  }
  if (parsedDecision === 'deny' || parsedDecision === 'allow' || parsedDecision === 'block') {
    return parsedDecision;
  }
  return 'allow';
}

function clipHookText(value) {
  const text = String(value ?? '');
  if (text.length <= HOOK_EXECUTION_LIMIT) return text;
  return `${text.slice(0, HOOK_EXECUTION_LIMIT)}\n…[truncated]`;
}

function executionFromShell(shell) {
  if (!shell || typeof shell !== 'object') return null;
  return {
    exitCode: shell.exitCode ?? null,
    stdout: clipHookText(shell.stdout),
    stderr: clipHookText(shell.stderr),
    ...(shell.timedOut ? { timedOut: true } : {}),
  };
}

function withExecution(payload, shell) {
  const execution = executionFromShell(shell);
  return execution ? { ...payload, execution } : payload;
}

function failClosedResult(reason) {
  return {
    ok: false,
    decision: 'deny',
    failClosed: true,
    reason,
  };
}

function failOpenResult() {
  return {
    ok: false,
    failOpen: true,
  };
}

function buildHookResult(exitCode, fields, eventName = '') {
  return {
    ok: true,
    decision: resolveDecision(exitCode, fields.decision, eventName),
    reason: fields.reason,
    additionalContext: fields.additionalContext,
    systemMessage: fields.systemMessage,
    updatedInput: fields.updatedInput,
    continue: fields.continue,
    stopReason: fields.stopReason,
    exitCode,
  };
}

function terminateHook(child) {
  const { pid } = child;
  if (!pid) return;
  const killChild = () => {
    try { child.kill('SIGKILL'); } catch { /* best effort */ }
  };
  if (process.platform === 'win32') {
    try {
      execFile('taskkill.exe', ['/pid', String(pid), '/T', '/F'], {
        timeout: 2000,
        windowsHide: true,
      }, (error) => {
        if (error) killChild();
      }).unref();
    } catch {
      killChild();
    }
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    killChild();
  }
}

function runShellCommand(command, { input, env, timeoutMs, cwd }) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      // On POSIX a dedicated process group lets us terminate the shell and its children.
      detached: process.platform !== 'win32',
      windowsHide: true,
      env: { ...process.env, ...env },
      ...(cwd ? { cwd } : {}),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };

    const timer = setTimeout(() => {
      finish({ timedOut: true, exitCode: null, stdout, stderr });
      terminateHook(child);
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      finish({
        error,
        exitCode: null,
        stdout,
        stderr,
      });
    });

    child.on('close', (exitCode, signal) => {
      finish({
        killed: Boolean(signal),
        signal,
        exitCode,
        stdout,
        stderr,
      });
    });

    // A fast-exiting hook can close its input before the parent finishes writing.
    child.stdin.on('error', () => {});
    if (input != null) {
      child.stdin.end(JSON.stringify(input));
    } else {
      child.stdin.end();
    }
  });
}

export async function runCommandHook({
  command,
  timeout = DEFAULT_TIMEOUT_SEC,
  failClosed = false,
  input = null,
  env = {},
  cwd,
} = {}) {
  const expanded = expandHookCommandPlaceholders(command, env);
  const timeoutSec = Number.isFinite(Number(timeout)) ? Number(timeout) : DEFAULT_TIMEOUT_SEC;
  const timeoutMs = Math.max(1, Math.floor(timeoutSec * 1000));

  let result;
  try {
    result = await runShellCommand(expanded, {
      input,
      env,
      timeoutMs,
      cwd,
    });
  } catch (error) {
    if (failClosed) {
      return failClosedResult(error?.message || 'Hook command failed');
    }
    return failOpenResult();
  }

  if (result.error) {
    if (failClosed) {
      return withExecution(failClosedResult(result.error.message || 'Hook command failed'), result);
    }
    return withExecution(failOpenResult(), result);
  }

  if (result.timedOut || result.killed) {
    if (failClosed) {
      return withExecution(failClosedResult(
        result.timedOut ? 'Hook command timed out' : 'Hook command was terminated',
      ), result);
    }
    return withExecution(failOpenResult(), result);
  }

  const exitCode = result.exitCode ?? 1;
  const eventName = String(input?.hook_event_name || '');
  const fields = extractHookFields(parseStdout(result.stdout), eventName);

  if (exitCode !== 0 && exitCode !== 2) {
    if (failClosed) {
      return withExecution(
        failClosedResult(fields.reason || `Hook command exited with code ${exitCode}`),
        result,
      );
    }
    return withExecution(failOpenResult(), result);
  }

  return withExecution(buildHookResult(exitCode, fields, eventName), result);
}
