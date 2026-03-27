import { handleChat } from './commands/chat.js';
import { handleRun } from './commands/run.js';
import { handleConfig } from './commands/config.js';
import { handleDoctor } from './commands/doctor.js';
import { handleSkill } from './commands/skill.js';

const VERSION = '0.1.0';

function printHelp() {
  console.log(`codemini ${VERSION}
Usage:
  codemini chat [prompt] [--plain]
  codemini run <task> [--max-steps N]
  codemini config set|get|list <key> [value]
  codemini doctor
  codemini skill list|install|enable|disable|inspect|reindex
  codemini --version
  codemini --help`);
}

export async function runCli(args) {
  const [command, ...rest] = args;

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === '--version' || command === '-v' || command === 'version') {
    console.log(VERSION);
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
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}
