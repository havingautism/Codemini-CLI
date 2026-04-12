import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { loadConfig } from '../core/config-store.js';
import { createChatRuntime } from '../core/chat-runtime.js';
import { buildDefaultSystemPrompt } from '../core/default-system-prompt.js';
import { resolveSession } from '../core/session-store.js';
import pkg from '../../package.json' with { type: 'json' };

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

    const React = (await import('react')).default;
    const { render } = await import('ink');
    const { ChatApp } = await import('../tui/chat-app.js');

    const instance = render(
      React.createElement(ChatApp, {
        runtime,
        sessionId: session.id,
        model: parsed.model || config.model.name,
        sdkProvider: config.sdk?.provider || 'openai-compatible',
        language: config.ui?.language || 'zh',
        shellName: config.shell?.default || 'powershell',
        safeMode: config.policy?.safe_mode !== false,
        version: pkg.version
      })
    );

    // Patch Ink's renderInteractiveFrame to never use clearTerminal.
    // Ink calls clearTerminal (ESC[2J + ESC[H]) when the output frame exceeds
    // the terminal viewport height, which resets the scroll position to the top
    // and prevents the user from scrolling freely during streaming.
    // By always using incremental logUpdate updates instead, old content scrolls
    // into the terminal's scrollback naturally and the user can scroll freely.
    const origRenderFrame = instance.renderInteractiveFrame;
    instance.renderInteractiveFrame = function (output, outputHeight, staticOutput) {
      const hasStaticOutput = staticOutput !== '';
      const outputToRender = output + '\n';

      if (hasStaticOutput) {
        this.fullStaticOutput += staticOutput;
        this.log.clear();
        this.options.stdout.write(staticOutput);
        this.log(outputToRender);
      } else if (output !== this.lastOutput || this.log.isCursorDirty()) {
        this.throttledLog(outputToRender);
      }
      this.lastOutput = output;
      this.lastOutputToRender = outputToRender;
      this.lastOutputHeight = outputHeight;
    };

    await instance.waitUntilExit();
  } finally {
    await runtime.dispose?.();
  }
}
