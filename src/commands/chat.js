import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { parseArgs } from 'node:util';
import { loadConfig } from '../core/config-store.js';
import { createChatRuntime } from '../core/chat-runtime.js';
import { buildDefaultSystemPrompt } from '../core/default-system-prompt.js';
import { createSession, resolveSession } from '../core/session-store.js';
import { getGeneralWorkspaceDir } from '../core/webui-sidebar-config.js';
import { VERSION } from '../core/version.js';
import { isGoalSteeringInput, isImmediateGoalControl, parseGoalCommand } from '../core/goal-command.js';

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
  let streamedAnswer = false;
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
    if (event?.type === 'assistant:start') streamedAnswer = false;
    if (event?.type === 'goal:waiting') {
      writeActivity(event, '目标');
      return;
    }
    if (event?.type === 'assistant:delta' && event.text) {
      streamed = true;
      streamedAnswer = true;
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
    if (result.goalSummary) write(`${streamedAnswer ? result.goalSummary : result.text}\n`);
    return result;
  }
  if (result.text) write(`${result.text}\n`);
  return result;
}

export async function runPlainLoop(runtime, { stdin = input, stdout = output } = {}) {
  stdout.write('Codemini CLI 文本模式。按 Ctrl+C 或发送 EOF 退出。\n');
  const rl = readline.createInterface({ input: stdin, output: stdout, prompt: 'codemini> ' });
  let pending;
  const printControl = async line => {
    const result = await runtime.submitGoalControl(line);
    if (result?.text) stdout.write(result.text + '\n');
    return result?.goalControl !== false;
  };
  rl.on('SIGINT', () => {
    if (runtime.isGoalRunning?.()) void printControl('/goal pause').catch(error => stdout.write(error.message + '\n'));
    else rl.close();
  });
  try {
    if (stdin.isTTY) rl.prompt();
    for await (const line of rl) {
      if (pending && (isImmediateGoalControl(line) || isGoalSteeringInput(line))) {
        if (await printControl(line)) {
          if (stdin.isTTY) rl.prompt();
          continue;
        }
      }
      if (pending) await pending;
      const command = parseGoalCommand(line);
      const turn = submitAndPrint(runtime, line, { output: stdout });
      if (command?.action === 'create' || command?.action === 'resume') {
        // 保持读入开放，允许正在执行目标的用户即时纠偏或暂停。
        pending = turn.catch(error => stdout.write(error.message + '\n')).finally(() => { pending = null; });
      } else if ((await turn).type === 'exit') {
        break;
      }
      if (stdin.isTTY) rl.prompt();
    }
  } finally {
    rl.close();
    await pending;
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
