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

  await instance.waitUntilExit();
}
