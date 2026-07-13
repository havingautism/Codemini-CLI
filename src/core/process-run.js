import { execa } from 'execa';

/**
 * Run a subprocess with timeout and optional stdin.
 * Returns { code, stdout, stderr, stdoutBuffer, stderrBuffer } (git-oplog compatible).
 */
export async function runProcess(command, args = [], {
  cwd,
  input = null,
  allowFailure = false,
  timeoutMs = 120_000,
  env
} = {}) {
  const subprocess = execa(command, args, {
    cwd,
    input: input == null ? undefined : input,
    timeout: timeoutMs,
    reject: false,
    windowsHide: true,
    env,
    all: false
  });

  let result;
  try {
    result = await subprocess;
  } catch (error) {
    if (error?.timedOut) {
      throw new Error(`${command} timed out after ${timeoutMs}ms`);
    }
    throw error;
  }

  const stdout = String(result.stdout ?? '');
  const stderr = String(result.stderr ?? '');
  const code = result.exitCode ?? (result.failed ? 1 : 0);
  const payload = {
    code,
    stdout,
    stderr,
    stdoutBuffer: Buffer.from(stdout, 'utf8'),
    stderrBuffer: Buffer.from(stderr, 'utf8')
  };

  if (code !== 0 && !allowFailure) {
    throw new Error(stderr.trim() || stdout.trim() || `${command} exited with code ${code}`);
  }

  return payload;
}

export function runGit(args, options = {}) {
  return runProcess('git', args, options);
}
