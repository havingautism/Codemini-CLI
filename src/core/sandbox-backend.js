import { spawn } from 'node:child_process';
import { canUseOsConfine, rememberOsFallback, rememberWindowsVmFailure } from './sandbox-probe.js';
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
    if (policy.hostFallback && binShell !== 'pwsh') {
      throw unavailableError(policy, 'The shell switched to Windows PowerShell. Start a new turn so the command can be generated and reviewed for the host.');
    }
    return { kind: 'host', policy, wrapped: false };
  }

  if (policy.backend === 'vm') {
    try {
      await ensureVmSandbox({ policy, config, port });
      const wrapped = createSandboxProcess({ command, config, policy, port });
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
      if (platform === 'win32' && error instanceof SandboxUnavailableError) {
        rememberWindowsVmFailure({ workspaceRoot: policy.workspaceRoot, image: config?.sandbox?.image });
        if (resolveSandboxPolicy({ config, cwd, platform, mode }).hostFallback) {
          throw unavailableError(policy, 'Microsandbox failed to start. Start a new turn to run and review commands in Windows PowerShell.');
        }
        throw unavailableError(policy, 'Microsandbox failed to start. PowerShell is selected for Windows host commands. Choose full system access to run on the host.');
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
      ? ' Windows has no Landlock/Seatbelt fallback. Choose full system access to run in PowerShell on the host.'
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
