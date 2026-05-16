import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { getShellSystemPrompt } from './shell-profile.js';

function formatToolPath(...segments) {
  return JSON.stringify(path.join(process.cwd(), ...segments));
}

function getToolFewShotBlock() {
  const cwd = process.cwd();
  const authServicePath = formatToolPath('src', 'auth', 'service.ts');
  const reducerRangePath = JSON.stringify(`${path.join(cwd, 'src', 'store', 'reducer.ts')}:110-150`);
  const notesPath = formatToolPath('notes.txt');
  return `# Tool Examples

Use these as style examples for tool calls:

Current working directory: ${cwd}
When a tool takes path, build it from the current working directory and prefer absolute paths.
If the user mentions a project-relative path like src/app.ts, resolve it from ${cwd} instead of guessing parent directories.

1. File discovery then read
User: compare the auth flow
Assistant: first narrow the search with the project index
Tool: query_project_index({"query":"auth flow","path":"src","max_results":3})
Tool: read({"path":${authServicePath}})

If the visible tool list does not include a needed capability, load it with tool_search instead of assuming it does not exist.
Example:
Tool: tool_search({"query":"glob"})
Tool: glob({"pattern":"src/**/*.ts"})

2. Targeted search then exact text edit
User: rename loginUser to signInUser
Assistant: first find the exact occurrences
Tool: grep({"pattern":"loginUser","path":"src"})
Tool: edit({"path":${authServicePath},"old_text":"loginUser","new_text":"signInUser"})

3. Read a specific range
User: inspect the reducer around line 120
Assistant: read only the needed range
Tool: read({"path":${reducerRangePath}})

4. Track a complex task with todos
User: update the login flow and verify it
Assistant: create a focused todo checklist before starting
Tool: update_todos({"todos":[{"content":"Inspect the current login flow","activeForm":"Inspecting the current login flow","status":"in_progress"},{"content":"Implement the requested login changes","activeForm":"Implementing the requested login changes","status":"pending"},{"content":"Run focused verification for the login flow","activeForm":"Running focused verification for the login flow","status":"pending"}]})
Assistant: keep the checklist updated as each phase finishes, and do not give a completion-style wrap-up until the checklist is complete or a blocker is recorded

5. Create a new file
User: add a notes file
Assistant: create the file directly
Tool: write({"path":${notesPath},"content":"todo\\n"})

6. Save a high-signal observation to memory
When you notice a reusable pattern, a user correction, a repeated failure, or a stable preference — save it to persistent memory. Choose scope carefully:
- scope "user" for personal preferences (language, reply style, interaction habits)
- scope "global" for cross-project lessons (environment quirks, general tool workflows)
- scope "project" for project-specific knowledge (architecture conventions, local config, test commands, file locations)

Examples:
Tool: save_memory({"content":"User prefers tab size 2 for all JSON files","scope":"user","kind":"preference"})
Tool: save_memory({"content":"This project uses vitest, not jest — run tests with npx vitest run","scope":"project","kind":"pattern"})
Tool: save_memory({"content":"WSL2 bash exec prefix does not support cd as a command","scope":"global","kind":"correction"})

7. Run a dream loop consolidation pass
When you want to review and consolidate inbox entries into long-term memory.
Tool: dream_consolidate({})

8. Read a live web page by URL
User: summarize https://example.com/docs
Assistant: load the web fetch tool and read the page directly
Tool: tool_search({"query":"web_fetch"})
Tool: web_fetch({"url":"https://example.com/docs"})

9. Search the web
User: search the web for latest pnpm release
Assistant: load the web search tool and run a targeted search
Tool: tool_search({"query":"web_search"})
Tool: web_search({"query":"latest pnpm release","max_results":5})

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
    getToolFewShotBlock(),
    getEnvBlock(),
    ...normalizePromptBlocks(options.extraPrompts)
  ].filter(Boolean).join('\n\n');
}
