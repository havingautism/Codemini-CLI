import { getShellSystemPrompt } from './shell-profile.js';

export function buildDefaultSystemPrompt(config = {}) {
  return `${getShellSystemPrompt(config?.shell?.default)} If a command or tool is blocked or fails, inspect the error and retry with allowed commands or tools. Do not claim filesystem access is impossible unless the allowed search/read tools also fail.`;
}
