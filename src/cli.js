import { handleChat } from './commands/chat.js';
import { handleRun } from './commands/run.js';
import { handleConfig } from './commands/config.js';
import { handleDoctor } from './commands/doctor.js';
import { handleSkill } from './commands/skill.js';
import { handleWeb } from './commands/web.js';
import { VERSION } from './core/version.js';

function printHelp() {
  console.log(`codemini ${VERSION}
Usage:
  codemini [prompt] [--plain] [--model <name>] [--fast]
  codemini chat [prompt] [--plain] [--model <name>] [--fast]
  codemini run <task> [--max-steps N] [--model <name>] [--fast]
  codemini run --harness <role> <task> [--max-steps N] [--model <name>] [--fast]
  codemini run --pipeline <task> [--model <name>] [--fast]
  codemini web [--port <port>] [--project <path>] [--session <id>] [--model <name>] [--no-open]
  codemini --web [--port <port>] [--project <path>] [--session <id>] [--model <name>] [--no-open]
  codemini config set|get|list <key> [value]
  codemini doctor
  codemini skill list|install|enable|disable|inspect|reindex [--scope=project|global]
  codemini --version
  codemini --help`);
}

export async function runCli(args) {
  const [command, ...rest] = args;
  const knownCommands = new Set(['chat', 'run', 'config', 'doctor', 'skill', 'web']);

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

  if (command === '--web' || command === '-web') {
    await handleWeb(rest);
    return;
  }

  if (!knownCommands.has(command)) {
    await handleChat(args);
    return;
  }

  switch (command) {
    case 'chat':
      await handleChat(rest);
      return;
    case 'run':
      await handleRun(rest);
      return;
    case 'config':
      await handleConfig(rest);
      return;
    case 'doctor':
      await handleDoctor();
      return;
    case 'skill':
      await handleSkill(rest);
      return;
    case 'web':
      await handleWeb(rest);
      return;
  }
}
