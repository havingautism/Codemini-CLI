import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { loadConfig } from '../core/config-store.js';
import { createChatRuntime } from '../core/chat-runtime.js';
import { buildDefaultSystemPrompt } from '../core/default-system-prompt.js';
import { resolveSession } from '../core/session-store.js';
import { VERSION } from '../core/version.js';

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
  const result = await runtime.submitMessage(
    typeof line === 'string' ? { text: line } : line,
    (event) => {
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
    }
  );
  if (result.type === 'exit' || result.type === 'noop') return result;
  if (streamed) {
    if (!atLineStart) write('\n');
    return result;
  }
  if (result.text) write(`${result.text}\n`);
  return result;
}

async function runPlainLoop(runtime) {
  console.log('Codemini CLI plain mode. Press Ctrl+C or send EOF to exit.');
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

export async function handleChat(args) {
  const parsed = parseChatArgs(args);
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

    const React = (await import('react')).default;
    const { render } = await import('ink');
    const { ChatApp } = await import('../tui/chat-app.js');

    const instance = render(
      React.createElement(ChatApp, {
        runtime,
        sessionId: session.id,
        model: selectedModel || config.model.name,
        sdkProvider: config.sdk?.provider || 'openai-compatible',
        language: config.ui?.language || 'zh',
        shellName: config.shell?.default || 'powershell',
        safeMode: config.policy?.safe_mode !== false,
        version: VERSION
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
