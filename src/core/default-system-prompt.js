import os from 'node:os';
import fs from 'node:fs';
import { getShellSystemPrompt } from './shell-profile.js';

function getToolFewShotBlock() {
  const cwd = process.cwd();
  return `# Tool Examples

Use these as style examples for tool calls:

Current working directory: ${cwd}
When a tool takes file_path, build it from the current working directory and prefer absolute paths.
If the user mentions a project-relative path like src/app.ts, resolve it from ${cwd} instead of guessing parent directories.

1. File discovery then read
User: compare the auth flow
Assistant: first narrow the search with the project index
Tool: query_project_index({"query":"auth flow","path":"src","max_results":3})
Tool: read({"file_path":"${cwd}/src/auth/service.ts"})

If the visible tool list does not include a needed capability, load it with tool_search instead of assuming it does not exist.
Example:
Tool: tool_search({"query":"glob"})
Tool: glob({"pattern":"src/**/*.ts"})

2. Targeted search then exact text edit
User: rename loginUser to signInUser
Assistant: first find the exact occurrences
Tool: grep({"pattern":"loginUser","path":"src"})
Tool: edit({"file_path":"${cwd}/src/auth/service.ts","old_string":"loginUser","new_string":"signInUser"})

3. Read a specific range
User: inspect the reducer around line 120
Assistant: read only the needed range
Tool: read({"path":"${cwd}/src/store/reducer.ts:110-150"})

4. Track a complex task with todos
User: update the login flow and verify it
Assistant: create a focused todo checklist before starting
Tool: update_todos({"todos":[{"content":"Inspect the current login flow","activeForm":"Inspecting the current login flow","status":"in_progress"},{"content":"Implement the requested login changes","activeForm":"Implementing the requested login changes","status":"pending"},{"content":"Run focused verification for the login flow","activeForm":"Running focused verification for the login flow","status":"pending"}]})
Assistant: keep the checklist updated as each phase finishes, and do not give a completion-style wrap-up until the checklist is complete or a blocker is recorded

5. Create a new file
User: add a notes file
Assistant: create the file directly
Tool: write({"file":"${cwd}/notes.txt","text":"todo\\n"})

6. Capture a high-signal observation during work
When you notice a reusable pattern, a user correction, a repeated failure, or a stable preference — capture it to the dream loop inbox for later consolidation.
Tool: capture_memory({"summary":"User prefers tab size 2 for all JSON files","scope":"global","type":"preference"})

7. Run a dream loop consolidation pass
When you want to review and consolidate inbox entries into long-term memory.
Tool: dream_consolidate({})

Prefer these direct tool shapes over multi-step metadata reads or shell fallbacks.
Prefer explicit absolute file_path values when the current working directory is known.`;
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

export function buildDefaultSystemPrompt(config = {}) {
  return `${getShellSystemPrompt(config?.shell?.default)}

${getToolFewShotBlock()}

${getEnvBlock()}`;
}
