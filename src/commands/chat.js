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
import pkg from '../../package.json' with { type: 'json' };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseChatArgs(args) {
  const parsed = {
    prompt: '',
    sessionId: undefined,
    model: undefined,
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

async function runPlainLoop(runtime) {
  console.log('CodeMini CLI plain mode. Use /help and /exit.');
  const rl = readline.createInterface({ input, output });
  try {
    while (true) {
      let line;
      try {
        line = await rl.question('codemini> ');
      } catch {
        break;
      }
      const result = await runtime.submit(line);
      if (result.type === 'exit') break;
      if (result.type === 'noop') continue;
      if (result.text) console.log(result.text);
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

function runOpenTuiProcess({ parsed, session, config, systemPrompt }) {
  return new Promise((resolve, reject) => {
    const bunBin = findBunBin();
    const cwd = process.cwd();
    const entryScript = path.resolve(cwd, 'src/tui/opentui/entry.js');
    const globalDir = path.resolve(cwd, '.codemini-global');

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
      globalDir,
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
  const config = await loadConfig();
  const session = await resolveSession(parsed.sessionId);
  const systemPrompt =
    parsed.system ||
    buildDefaultSystemPrompt(config);

  const runtime = await createChatRuntime({
    session,
    config,
    model: parsed.model,
    systemPrompt
  });

  try {
    if (parsed.prompt) {
      const result = await runtime.submit(parsed.prompt);
      if (result.text) console.log(result.text);
      return;
    }

    if (parsed.plain || !process.stdout.isTTY) {
      await runPlainLoop(runtime);
      return;
    }

    // Dispose the node-side runtime — the bun child process creates its own.
    await runtime.dispose?.();
    await runOpenTuiProcess({ parsed, session, config, systemPrompt });
  } finally {
    // runtime already disposed for the opentui path; clean up for plain/prompt paths.
    await runtime.dispose?.().catch(() => {});
  }
}
