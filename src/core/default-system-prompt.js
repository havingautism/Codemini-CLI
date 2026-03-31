import os from 'node:os';
import fs from 'node:fs';
import { getShellSystemPrompt } from './shell-profile.js';

function getEnvBlock() {
  const cwd = process.cwd();
  let isGitRepo = false;
  try {
    fs.accessSync(`${cwd}/.git`);
    isGitRepo = true;
  } catch {}

  return `<env>
Working directory: ${cwd}
Is directory a git repo: ${isGitRepo ? 'Yes' : 'No'}
Platform: ${process.platform}
Shell: ${os.userInfo().shell || 'unknown'}
OS Version: ${os.version || os.release()}
</env>`;
}

export function buildDefaultSystemPrompt(config = {}) {
  return `${getShellSystemPrompt(config?.shell?.default)}

${getEnvBlock()}`;
}
