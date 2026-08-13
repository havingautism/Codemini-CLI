import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_SEC = 30;

export function expandHookCommandPlaceholders(command, env = {}) {
  const merged = { ...process.env, ...env };
  return String(command ?? '')
    .replace(/\$\{CLAUDE_PROJECT_DIR\}/g, merged.CLAUDE_PROJECT_DIR ?? '')
    .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, merged.CLAUDE_PLUGIN_ROOT ?? '');
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

function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

function runShellCommand(command, { input, env, timeoutMs, cwd }) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      windowsHide: true,
      env: { ...process.env, ...env },
      ...(cwd ? { cwd } : {}),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child.pid);
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
        timedOut,
        exitCode: null,
        stdout,
        stderr,
      });
    });

    child.on('close', (exitCode, signal) => {
      finish({
        timedOut,
        killed: timedOut || Boolean(signal),
        signal,
        exitCode,
        stdout,
        stderr,
      });
    });

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
      return failClosedResult(result.error.message || 'Hook command failed');
    }
    return failOpenResult();
  }

  if (result.timedOut || result.killed) {
    if (failClosed) {
      return failClosedResult(
        result.timedOut ? 'Hook command timed out' : 'Hook command was terminated',
      );
    }
    return failOpenResult();
  }

  const exitCode = result.exitCode ?? 1;
  const eventName = String(input?.hook_event_name || '');
  const fields = extractHookFields(parseStdout(result.stdout), eventName);

  if (exitCode !== 0 && exitCode !== 2) {
    if (failClosed) {
      return failClosedResult(fields.reason || `Hook command exited with code ${exitCode}`);
    }
    return failOpenResult();
  }

  return buildHookResult(exitCode, fields, eventName);
}
