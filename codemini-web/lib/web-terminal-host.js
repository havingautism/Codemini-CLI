import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as pty from 'node-pty';
import { resolveShell } from '../../src/core/shell.js';
import { ensureNodePtySpawnHelperExecutable } from './node-pty-spawn-helper.js';
import {
  buildPowerShellColorBootstrap,
  buildTerminalColorEnv,
} from './terminal-env.js';

ensureNodePtySpawnHelperExecutable();

const terminals = new Map();
let detectedPwshCommand;

function findPowerShell7() {
  if (detectedPwshCommand !== undefined) return detectedPwshCommand;
  const result = spawnSync('where.exe', ['pwsh.exe'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  detectedPwshCommand =
    result.status === 0
      ? String(result.stdout || '').split(/\r?\n/).find(Boolean) || ''
      : '';
  return detectedPwshCommand;
}

function shellLabel(shellDefault) {
  const spec = resolveShell(shellDefault);
  const base = path.basename(spec.command).replace(/\.exe$/i, '');
  if (/pwsh|powershell/i.test(base)) return 'pwsh';
  if (/cmd/i.test(base)) return 'cmd';
  return base || 'shell';
}

function interactiveShell(shellDefault) {
  const spec = resolveShell(shellDefault);
  const label = shellLabel(shellDefault);
  if (process.platform === 'win32') {
    if (label === 'cmd') return { command: spec.command, args: ['/d'] };
    if (label === 'bash') return { command: spec.command, args: ['--login'] };
    const powerShell7 = findPowerShell7();
    return {
      command: powerShell7 || spec.command,
      args: [
        '-NoLogo',
        '-NoProfile',
        '-NoExit',
        '-Command',
        buildPowerShellColorBootstrap(),
      ],
    };
  }
  if (label === 'pwsh') {
    return { command: spec.command, args: ['-NoLogo', '-NoProfile'] };
  }
  return { command: spec.command, args: ['--login'] };
}

function send(message) {
  if (process.connected) process.send?.(message);
}

function spawnTerminal({ key, cwd, shellDefault, cols, rows }) {
  if (terminals.has(key)) return terminals.get(key);
  const shell = interactiveShell(shellDefault);
  let terminal;
  try {
    terminal = pty.spawn(shell.command, shell.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: buildTerminalColorEnv(process.env),
      useConpty: process.platform === 'win32',
    });
  } catch (error) {
    send({
      type: 'error',
      key,
      error: String(error?.message || error),
    });
    return null;
  }
  terminals.set(key, terminal);
  terminal.onData((data) => {
    if (terminals.get(key) !== terminal) return;
    send({ type: 'data', key, data });
  });
  terminal.onExit(({ exitCode, signal }) => {
    if (terminals.get(key) !== terminal) return;
    terminals.delete(key);
    send({ type: 'exit', key, exitCode, signal });
  });
  send({ type: 'ready', key });
  return terminal;
}

function restartTerminal(message) {
  const previous = terminals.get(message.key);
  terminals.delete(message.key);
  try {
    if (process.platform === 'win32') previous?.write('\x03exit\r');
    else previous?.kill();
  } catch {}
  spawnTerminal(message);
}

process.on('message', (message) => {
  if (!message || typeof message !== 'object') return;
  try {
    if (message.type === 'spawn') {
      spawnTerminal(message);
      return;
    }
    if (message.type === 'restart') {
      restartTerminal(message);
      return;
    }
    const terminal = terminals.get(message.key);
    if (message.type === 'input') {
      terminal?.write(String(message.data ?? ''));
    } else if (message.type === 'resize') {
      terminal?.resize(message.cols, message.rows);
    } else if (message.type === 'clear') {
      terminal?.clear();
      terminal?.write('\x0c');
    }
  } catch (error) {
    send({
      type: 'error',
      key: message.key,
      error: String(error?.message || error),
    });
  }
});

send({ type: 'host-ready' });
