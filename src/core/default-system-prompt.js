import { getShellSystemPrompt } from './shell-profile.js';

export function buildDefaultSystemPrompt(config = {}) {
  return `${getShellSystemPrompt(config?.shell?.default)} If a command or tool is blocked or fails, inspect the error and retry with allowed commands or tools. For AST-scoped edits, if edit rejects a call because kind=replace_block or ast_target is missing or stale, fix the tool arguments and retry instead of switching to a broader text edit. Do not claim filesystem access is impossible unless the allowed search/read tools also fail.`;
}
