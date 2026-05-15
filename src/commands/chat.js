import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { loadConfig } from '../core/config-store.js';
import { createChatRuntime } from '../core/chat-runtime.js';
import { buildDefaultSystemPrompt } from '../core/default-system-prompt.js';
import { resolveSession } from '../core/session-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseChatArgs(args) {
  const parsed = {
    prompt: '',
    sessionId: undefined,
    model: undefined,
    fast: false,
    system: undefined,
    plain: false
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--session') {
      parsed.sessionId = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--model') {
      parsed.model = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--fast' || arg === '--lite') {
      parsed.fast = true;
      continue;
    }
    if (arg === '--system') {
      parsed.system = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--plain') {
      parsed.plain = true;
      continue;
    }
    parsed.prompt += `${parsed.prompt ? ' ' : ''}${arg}`;
  }

  return parsed;
}

export async function submitAndPrint(runtime, line, { output: out = process.stdout, showSystemTools = false } = {}) {
  let streamed = false;
  let atLineStart = true;
  const write = (text) => {
    const value = String(text || '');
    if (!value) return;
    out.write(value);
    atLineStart = value.endsWith('\n');
  };
  const writeActivity = (event, label) => {
    const name = String(event?.name || '').trim();
    if (!name) return;
    const summary = String(event?.summary || '').trim();
    if (!atLineStart) write('\n');
    write(`[${label}] ${name}${summary ? ` - ${summary}` : ''}\n`);
  };
  const result = await runtime.submit(line, (event) => {
    if (event?.type === 'assistant:delta' && event.text) {
      streamed = true;
      write(event.text);
      return;
    }
    if (event?.type === 'tool:start') {
      streamed = true;
      writeActivity(event, 'tool:start');
      return;
    }
    if (event?.type === 'tool:end') {
      streamed = true;
      writeActivity(event, 'tool:end');
      return;
    }
    if (event?.type === 'tool:blocked') {
      streamed = true;
      writeActivity(event, 'tool:blocked');
      return;
    }
    if (event?.type === 'tool:error') {
      streamed = true;
      writeActivity(event, 'tool:error');
      return;
    }
    if (!showSystemTools && String(event?.type || '').startsWith('system_tool:')) {
      return;
    }
    if (event?.type === 'system_tool:start') {
      streamed = true;
      writeActivity(event, 'system:start');
      return;
    }
    if (event?.type === 'system_tool:end') {
      streamed = true;
      writeActivity(event, 'system:end');
      return;
    }
    if (event?.type === 'system_tool:error') {
      streamed = true;
      writeActivity(event, 'system:error');
    }
  });
  if (result.type === 'exit' || result.type === 'noop') return result;
  if (streamed) {
    if (!atLineStart) write('\n');
    return result;
  }
  if (result.text) write(`${result.text}\n`);
  return result;
}

async function runPlainLoop(runtime) {
  console.log('Codemini CLI plain mode. Use /help and /exit.');
  const rl = readline.createInterface({ input, output });
  try {
    while (true) {
      let line;
      try {
        line = await rl.question('codemini> ');
      } catch {
        break;
      }
      const result = await submitAndPrint(runtime, line, { output });
      if (result.type === 'exit') break;
    }
  } finally {
    rl.close();
  }
}

/**
 * Find the bun executable. Returns a path usable by Node's spawn().
 * - On Windows/WSL: looks for bun.exe
 * - On Unix: looks for bun binary
 * - Falls back to 'bun' on PATH
 */
function findBunBin() {
  const home = homedir();
  const candidates = [
    // project-local
    path.resolve(__dirname, '../../node_modules/bun/bin/bun.exe'),
    path.resolve(__dirname, '../../node_modules/bun/bin/bun'),
    // global npm (Windows AppData)
    path.join(home, 'AppData/Roaming/npm/node_modules/bun/bin/bun.exe'),
    // global npm (Unix)
    path.join(home, '.npm-global/lib/node_modules/bun/bin/bun'),
    // brew (macOS)
    '/usr/local/bin/bun',
    '/opt/homebrew/bin/bun',
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return 'bun';
}

function resolveChatGlobalDir(cwd = process.cwd()) {
  return process.env.CODEMINI_GLOBAL_DIR || path.resolve(cwd, '.codemini-global');
}

function runOpenTuiProcess({ parsed, session, config, systemPrompt, globalDir }) {
  return new Promise((resolve, reject) => {
    const bunBin = findBunBin();
    const cwd = process.cwd();
    const entryScript = path.resolve(cwd, 'src/tui/opentui/entry.js');
    const resolvedGlobalDir = globalDir || resolveChatGlobalDir(cwd);

    const args = [
      'run',
      entryScript,
      '--session',
      session.id,
      '--model',
      parsed.model || config.model.name,
      '--language',
      config.ui?.language || 'zh',
      '--shell',
      config.shell?.default || 'powershell',
      '--sdk-provider',
      config.sdk?.provider || 'openai-compatible',
      '--global-dir',
      resolvedGlobalDir,
    ];
    if (config.policy?.safe_mode === false) {
      args.push('--unsafe');
    }

    const child = spawn(bunBin, args, {
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
        CODEMINI_SYSTEM_PROMPT: systemPrompt
      }
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`OpenTUI process exited via signal ${signal}`));
        return;
      }
      if (code && code !== 0) {
        reject(new Error(`OpenTUI process exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
}

export async function handleChat(args) {
  const parsed = parseChatArgs(args);
  const globalDir = resolveChatGlobalDir();
  process.env.CODEMINI_GLOBAL_DIR = globalDir;
  const config = await loadConfig();
  const session = await resolveSession(parsed.sessionId);
  const selectedModel = parsed.fast ? (config.model?.fast_name || config.model?.name) : parsed.model;
  const systemPrompt =
    parsed.system ||
    buildDefaultSystemPrompt(config);

  const runtime = await createChatRuntime({
    session,
    config,
    model: selectedModel,
    systemPrompt
  });

  try {
    if (parsed.prompt) {
      await submitAndPrint(runtime, parsed.prompt, { output: process.stdout });
      return;
    }

    if (parsed.plain || !process.stdout.isTTY) {
      await runPlainLoop(runtime);
      return;
    }

    // Dispose the node-side runtime — the bun child process creates its own.
    await runtime.dispose?.();
    await runOpenTuiProcess({ parsed, session, config, systemPrompt, globalDir });
  } finally {
    // runtime already disposed for the opentui path; clean up for plain/prompt paths.
    await runtime.dispose?.().catch(() => {});
  }
}
