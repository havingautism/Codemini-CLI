import { handleChat } from './commands/chat.js';
import { handleRun } from './commands/run.js';
import { handleConfig } from './commands/config.js';
import { handleDoctor } from './commands/doctor.js';
import { handleSkill } from './commands/skill.js';
import pkg from '../package.json' with { type: 'json' };

const VERSION = pkg.version;

function printHelp() {
  console.log(`codemini ${VERSION}
Usage:
  codemini [prompt] [--plain]
  codemini chat [prompt] [--plain]
  codemini run <task> [--max-steps N] [--model <name>]
  codemini run --harness <role> <task> [--max-steps N] [--model <name>]
  codemini run --pipeline <task> [--model <name>]
  codemini config set|get|list <key> [value]
  codemini doctor
  codemini skill list|install|enable|disable|inspect|reindex [--scope=project|global]
  codemini --version
  codemini --help`);
}

export async function runCli(args) {
  const [command, ...rest] = args;
  const knownCommands = new Set(['chat', 'run', 'config', 'doctor', 'skill']);

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
  }
}
