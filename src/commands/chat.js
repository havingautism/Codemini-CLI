import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { parseArgs } from 'node:util';
import { loadConfig } from '../core/config-store.js';
import { createChatRuntime } from '../core/chat-runtime.js';
import { buildDefaultSystemPrompt } from '../core/default-system-prompt.js';
import { createSession, resolveSession } from '../core/session-store.js';
import { getGeneralWorkspaceDir } from '../core/webui-sidebar-config.js';
import { VERSION } from '../core/version.js';

export function parseChatArgs(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      session: { type: 'string' },
      model: { type: 'string' },
      fast: { type: 'boolean' },
      lite: { type: 'boolean' },
      system: { type: 'string' },
      plain: { type: 'boolean' },
    },
  });
  return {
    prompt: positionals.join(' '),
    sessionId: values.session,
    model: values.model,
    fast: values.fast === true || values.lite === true,
    system: values.system,
    plain: values.plain === true,
  };
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
  const launchCwd = process.cwd();
  let session = await resolveSession(parsed.sessionId);
  while (session) {
    const config = await loadConfig();
    const selectedModel = parsed.fast ? (config.model?.fast_name || config.model?.name) : parsed.model;
    const workspaceRoot = session?.projectDir || process.cwd();
    const runtime = await createChatRuntime({
      session,
      config,
      model: selectedModel,
      systemPrompt: parsed.system || buildDefaultSystemPrompt(config, { workspaceRoot }),
      systemPromptFactory: parsed.system
        ? null
        : (nextConfig) => buildDefaultSystemPrompt(nextConfig, { workspaceRoot }),
      workspaceRoot,
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

      const { runOpenCodeTui } = await import('../tui/opencode-chat-app.js');
      const result = await runOpenCodeTui({
        runtime,
        sessionId: session.id,
        model: selectedModel || config.model.name,
        safeMode: config.policy?.safe_mode !== false,
        language: config.ui?.language || 'zh',
        version: VERSION,
        workspaceDir: getGeneralWorkspaceDir(),
        currentDirectory: launchCwd
      });
      if (result?.newSession) session = await createSession(result.projectDir || launchCwd);
      else if (result?.sessionId && result.sessionId !== session.id) session = await resolveSession(result.sessionId);
      else return;
    } finally {
      await runtime.dispose?.();
    }
  }
}
