import { loadConfig } from '../core/config-store.js';
import { createChatRuntime } from '../core/chat-runtime.js';
import { buildDefaultSystemPrompt } from '../core/default-system-prompt.js';
import { resolveSession } from '../core/session-store.js';
import { parseChatArgs } from './chat.js';

export const chatPiDeps = {
  loadConfig,
  createChatRuntime,
  buildDefaultSystemPrompt,
  resolveSession,
  runPiChatApp: async (options) => {
    const { runPiChatApp } = await import('../tui-pi/app.js');
    return runPiChatApp(options);
  }
};

export async function handleChatPi(args) {
  const parsed = parseChatArgs(args);
  if (parsed.plain) {
    throw new Error('chat-pi does not support --plain yet');
  }
  const config = await chatPiDeps.loadConfig();
  const session = await chatPiDeps.resolveSession(parsed.sessionId);
  const systemPrompt = parsed.system || chatPiDeps.buildDefaultSystemPrompt(config);

  const runtime = await chatPiDeps.createChatRuntime({
    session,
    config,
    model: parsed.model,
    systemPrompt
  });

  try {
    await chatPiDeps.runPiChatApp({
      runtime,
      sessionId: session.id,
      model: parsed.model || config.model.name,
      sdkProvider: config.sdk?.provider || 'openai-compatible',
      language: config.ui?.language || 'zh',
      shellName: config.shell?.default || 'powershell',
      safeMode: config.policy?.safe_mode !== false
    });
  } finally {
    await runtime.dispose?.();
  }
}
