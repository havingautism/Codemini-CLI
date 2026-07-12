import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { getShellSystemPrompt } from './shell-profile.js';

function formatToolPath(...segments) {
  return JSON.stringify(path.join(process.cwd(), ...segments));
}

function getToolFewShotBlock(config = {}) {
  const cwd = process.cwd();
  const authServicePath = formatToolPath('src', 'auth', 'service.ts');
  const reducerRangePath = JSON.stringify(`${path.join(cwd, 'src', 'store', 'reducer.ts')}:110-150`);
  const notesPath = formatToolPath('notes.txt');
  return `# Tool Examples

Use these as style examples for tool calls:

Current working directory: ${cwd}
When a tool takes path, build it from the current working directory and prefer absolute paths.
If the user mentions a project-relative path like src/app.ts, resolve it from ${cwd} instead of guessing parent directories.
Tool arguments must be valid JSON objects. When a string contains file content, encode newlines as \\n inside the JSON string; never put raw unescaped line breaks inside a JSON string.

1. File discovery then read
User: compare the auth flow
Assistant: first narrow the search with the project index
Tool: query_project_index({"query":"auth flow","path":"src","max_results":3})
Tool: read({"path":${authServicePath}})

If the visible tool list does not include a needed deferred capability, load it with tool_search instead of assuming it does not exist.
Example:
Tool: tool_search({"query":"glob"})
Tool: glob({"pattern":"src/**/*.ts"})
To discover or load Codemini skills, use the skill tool directly against the indexed registry:
Tool: skill({"query":"fix ts generic error"})
Tool: skill({"name":"list"})
Tool: skill({"query":"debugging workflow"})
Do not grep or list skills directories to discover skills.

2. Targeted search then exact text edit
User: rename loginUser to signInUser
Assistant: first find the exact occurrences
Tool: grep({"pattern":"loginUser","path":"src"})
Tool: edit({"path":${authServicePath},"old_text":"loginUser","new_text":"signInUser"})

For an existing file full rewrite, use edit with new_content:
Tool: edit({"path":${authServicePath},"new_content":"export function signInUser() {\\n  return true;\\n}\\n"})
If the intent is explicitly whole-file output or overwrite, write is also available:
Tool: write({"path":${authServicePath},"content":"export function signInUser() {\\n  return true;\\n}\\n","overwrite":true})

3. Read a specific range
User: inspect the reducer around line 120
Assistant: read only the needed range
Tool: read({"path":${reducerRangePath}})

4. Write a new file
User: add a notes file
Assistant: write the file directly
Tool: write({"path":${notesPath},"content":"todo\\n"})

For a large or multi-file code patch, use apply_patch with one escaped patch_text string:
Tool: apply_patch({"patch_text":"*** Begin Patch\\n*** Update File: ${path.join('src', 'auth', 'service.ts').replace(/\\/g, '/')}\\n@@\\n-export const enabled = false;\\n+export const enabled = true;\\n*** End Patch"})

Use update_todos for genuinely multi-step work. Save only durable, high-signal preferences or lessons to memory, with user/project/global scope as appropriate. Load web_fetch or web_search through tool_search when current external information is needed.

Prefer these direct tool shapes over multi-step metadata reads or shell fallbacks.
Prefer explicit absolute path values when the current working directory is known.`;
}

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

function normalizePromptBlocks(blocks) {
  if (!blocks) return [];
  if (Array.isArray(blocks)) return blocks.filter(Boolean).map(String);
  return [String(blocks)].filter(Boolean);
}

export function buildDefaultSystemPrompt(config = {}, options = {}) {
  return [
    getShellSystemPrompt(config?.shell?.default),
    getToolFewShotBlock(config),
    getEnvBlock(),
    ...normalizePromptBlocks(options.extraPrompts)
  ].filter(Boolean).join('\n\n');
}
