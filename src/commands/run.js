import { loadConfig } from '../core/config-store.js';
import { buildDefaultSystemPrompt } from '../core/default-system-prompt.js';
import { runAgentLoop } from '../core/agent-loop.js';
import { createChatCompletion } from '../core/provider/openai-compatible.js';
import { buildSystemPromptWithSoul } from '../core/soul.js';
import { getBuiltinTools } from '../core/tools.js';

function parseRunArgs(args) {
  const parsed = {
    task: '',
    model: undefined,
    maxSteps: 8
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--model') {
      parsed.model = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--max-steps') {
      parsed.maxSteps = Number(args[i + 1] || 8);
      i += 1;
      continue;
    }
    parsed.task += `${parsed.task ? ' ' : ''}${arg}`;
  }
  return parsed;
}

export async function handleRun(args) {
  const parsed = parseRunArgs(args);
  if (!parsed.task) {
    throw new Error('run requires <task>');
  }

  const config = await loadConfig();
  const { definitions, handlers, formatters, deferredDefinitions } = getBuiltinTools({
    workspaceRoot: process.cwd(),
    config
  });
  const systemPrompt = await buildSystemPromptWithSoul(buildDefaultSystemPrompt(config), config);

  const result = await runAgentLoop({
    systemPrompt,
    userPrompt: parsed.task,
    model: parsed.model || config.model.name,
    toolDefinitions: definitions,
    toolHandlers: handlers,
    toolFormatters: formatters,
    deferredDefinitions,
    maxSteps: parsed.maxSteps,
    requestCompletion: async ({ messages, tools, model }) =>
      createChatCompletion({
        baseUrl: config.gateway.base_url,
        apiKey: config.gateway.api_key,
        model,
        messages,
        tools,
        timeoutMs: config.gateway.timeout_ms || 90000,
        maxRetries: config.gateway.max_retries ?? 2
      })
  });

  console.log(result.text);
}
