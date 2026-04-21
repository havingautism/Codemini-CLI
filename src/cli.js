import { handleChat } from './commands/chat.js';
import { handleChatPi } from './commands/chat-pi.js';
import { handleRun } from './commands/run.js';
import { handleConfig } from './commands/config.js';
import { handleDoctor } from './commands/doctor.js';
import { handleSkill } from './commands/skill.js';
import pkg from '../package.json' with { type: 'json' };

const VERSION = pkg.version;

export const cliHandlers = {
  chat: handleChat,
  'chat-pi': handleChatPi,
  run: handleRun,
  config: handleConfig,
  doctor: handleDoctor,
  skill: handleSkill
};

function printHelp() {
  console.log(`codemini ${VERSION}
Usage:
  codemini [prompt] [--plain]
  codemini chat [prompt] [--plain]
  codemini chat-pi [prompt]
  codemini run <task> [--max-steps N] [--model <name>]
  codemini run --harness <role> <task> [--max-steps N] [--model <name>]
  codemini run --pipeline <task> [--model <name>]
  codemini config set|get|list <key> [value]
  codemini doctor
  codemini skill list|install|enable|disable|inspect|reindex
  codemini --version
  codemini --help`);
}

export async function runCli(args) {
  const [command, ...rest] = args;
  const knownCommands = new Set(Object.keys(cliHandlers));

  if (!command || command === '--help' || command === '-h') {
    if (!command) {
      await handleChat([]);
      return;
    }
    printHelp();
    return;
  }

  if (command === '--version' || command === '-v' || command === 'version') {
    console.log(VERSION);
    return;
  }

  if (!knownCommands.has(command)) {
    await handleChat(args);
    return;
  }

  await cliHandlers[command](rest);
}
