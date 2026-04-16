import { loadConfig } from "../../core/config-store.js";
import { createChatRuntime } from "../../core/chat-runtime.js";
import { buildDefaultSystemPrompt } from "../../core/default-system-prompt.js";
import { resolveSession } from "../../core/session-store.js";
import { startOpenTui } from "./app.js";
import { readFileSync } from "node:fs";
const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf-8"));

function parseArgs(args: string[]) {
  const parsed = {
    sessionId: undefined as string | undefined,
    model: undefined as string | undefined,
    globalDir: undefined as string | undefined,
    language: "zh",
    shellName: "powershell",
    sdkProvider: "openai-compatible",
    safeMode: true,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--session") {
      parsed.sessionId = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--model") {
      parsed.model = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--global-dir") {
      parsed.globalDir = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--language") {
      parsed.language = args[index + 1] || "zh";
      index += 1;
      continue;
    }
    if (arg === "--shell") {
      parsed.shellName = args[index + 1] || "powershell";
      index += 1;
      continue;
    }
    if (arg === "--sdk-provider") {
      parsed.sdkProvider = args[index + 1] || "openai-compatible";
      index += 1;
      continue;
    }
    if (arg === "--unsafe") {
      parsed.safeMode = false;
      continue;
    }
  }

  return parsed;
}

const parsed = parseArgs(process.argv.slice(2));
if (parsed.globalDir) {
  process.env.CODEMINI_GLOBAL_DIR = parsed.globalDir;
}
const config = await loadConfig();
const session = await resolveSession(parsed.sessionId);
const systemPrompt = process.env.CODEMINI_SYSTEM_PROMPT || buildDefaultSystemPrompt(config);
const runtime = await createChatRuntime({
  session,
  config,
  model: parsed.model,
  systemPrompt,
});

try {
  await startOpenTui({
    runtime,
    sessionId: session.id,
    sessionMessages: session.messages,
    model: parsed.model || config.model.name,
    sdkProvider: parsed.sdkProvider || config.sdk?.provider || "openai-compatible",
    language: parsed.language || config.ui?.language || "zh",
    shellName: parsed.shellName || config.shell?.default || "powershell",
    safeMode: parsed.safeMode,
    version: pkg.version,
  });
} finally {
  await runtime.dispose?.();
}
