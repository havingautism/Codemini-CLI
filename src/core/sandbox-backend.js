import { spawn } from 'node:child_process';
import { canUseOsConfine, rememberOsFallback } from './sandbox-probe.js';
import { resolveSandboxPolicy } from './sandbox-policy.js';
import {
  SandboxUnavailableError,
  createSandboxProcess,
  ensureVmSandbox,
} from './sandbox-runtime.js';
import { wrapShellCommandForSandbox } from './sandbox-os.js';

export { SandboxUnavailableError };

function unavailableError(policy, extra = '') {
  const suffix = extra ? ` ${extra}` : '';
  return new SandboxUnavailableError(
    `sandbox mode "${policy?.mode || 'workspace-write'}" is requested but no usable sandbox backend is available; refusing to run unconfined.${suffix}`,
    { mode: policy?.mode || '' },
  );
}

async function prepareOsExecution({
  command,
  config,
  cwd,
  platform = process.platform,
  binShell,
  abortSignal,
  mode,
} = {}) {
  const wrap = await wrapShellCommandForSandbox({
    command,
    config,
    cwd,
    platform,
    binShell,
    abortSignal,
    mode,
  });
  if (!wrap.wrapped) {
    throw unavailableError(wrap.policy, 'OS confinement could not wrap the command.');
  }
  return {
    kind: 'os',
    policy: wrap.policy,
    command: wrap.command,
    executable: wrap.executable || '',
    args: wrap.args || null,
    wrapped: true,
  };
}

export async function prepareSandboxExecution({
  command,
  config,
  cwd,
  platform = process.platform,
  binShell,
  abortSignal,
  mode,
  port = 0,
} = {}) {
  const policy = resolveSandboxPolicy({ config, cwd, platform, mode });
  if (!policy.enabled) {
    return { kind: 'host', policy, wrapped: false };
  }

  if (policy.backend === 'vm') {
    try {
      await ensureVmSandbox({ policy, config, port });
      const wrapped = createSandboxProcess({ command, config, cwd, mode, port });
      if (!wrapped) throw unavailableError(policy);
      return {
        kind: 'vm',
        policy: { ...wrapped.policy, backend: 'vm' },
        child: wrapped.child,
        wrapped: true,
      };
    } catch (error) {
      if (canUseOsConfine(platform)) {
        rememberOsFallback();
        return prepareOsExecution({
          command,
          config,
          cwd,
          platform,
          binShell,
          abortSignal,
          mode,
        });
      }
      throw error;
    }
  }

  if (policy.backend === 'os') {
    return prepareOsExecution({
      command,
      config,
      cwd,
      platform,
      binShell,
      abortSignal,
      mode,
    });
  }

  throw unavailableError(
    policy,
    platform === 'win32'
      ? ' Windows has no Landlock/Seatbelt fallback; install Microsandbox or set sandbox.enabled false.'
      : '',
  );
}

export function spawnPreparedSandbox({
  prepared,
  shellSpec,
  shellCommand,
  cwd,
}) {
  if (prepared?.kind === 'vm' && prepared.child) return prepared.child;
  if (prepared?.kind === 'os' && prepared.executable) {
    return spawn(prepared.executable, prepared.args || [], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  if (prepared?.kind === 'os' && prepared.command) {
    return spawn(prepared.command, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  return spawn(shellSpec.command, [...shellSpec.args, shellCommand], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
