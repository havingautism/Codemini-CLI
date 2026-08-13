import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { getShellSystemPrompt, resolveShellContext } from './shell-profile.js';

function resolvePromptCwd(options = {}) {
  const raw = options.workspaceRoot || options.cwd || process.cwd();
  try {
    return path.resolve(raw);
  } catch {
    return String(raw || process.cwd());
  }
}

function formatToolPath(cwd, ...segments) {
  return JSON.stringify(path.join(cwd, ...segments));
}

function getToolFewShotBlock(config = {}, cwd = process.cwd(), platform = process.platform) {
  const shellContext = resolveShellContext(config, { cwd, platform });
  const vm = shellContext.sandbox.backend === 'vm';
  const osConfine = shellContext.sandbox.backend === 'os';
  const toolPath = (...segments) => vm
    ? JSON.stringify(segments.join('/'))
    : formatToolPath(cwd, ...segments);
  const authServicePath = toolPath('src', 'auth', 'service.ts');
  const reducerPath = vm
    ? 'src/store/reducer.ts'
    : path.join(cwd, 'src', 'store', 'reducer.ts');
  const reducerRangePath = JSON.stringify(`${reducerPath}:110-150`);
  const notesPath = toolPath('notes.txt');
  const isWin = platform === 'win32';
  const editExample = isWin
    ? `Tool: edit({"path":${authServicePath},"old_text":"loginUser","new_text":"signInUser"})`
    : `Tool: edit({"file_path":${authServicePath},"old_string":"loginUser","new_string":"signInUser"})`;
  const readExample = isWin
    ? `Tool: read({"path":${authServicePath}})`
    : `Tool: read({"file_path":${authServicePath}})`;
  const rangeReadExample = isWin
    ? `Tool: read({"path":${reducerRangePath}})`
    : `Tool: read({"file_path":${JSON.stringify(path.join(cwd, 'src', 'store', 'reducer.ts'))},"offset":110,"limit":41})`;
  const rewriteExample = isWin
    ? `For an existing file full rewrite, use edit with new_content:
Tool: edit({"path":${authServicePath},"new_content":"export function signInUser() {\\n  return true;\\n}\\n"})
If the intent is explicitly whole-file output or overwrite, write is also available:
Tool: write({"path":${authServicePath},"content":"export function signInUser() {\\n  return true;\\n}\\n","overwrite":true})`
    : `Before editing or overwriting an existing file, read it first. Use write for an intentional whole-file replacement:
Tool: write({"file_path":${authServicePath},"content":"export function signInUser() {\\n  return true;\\n}\\n"})`;
  const newFileExample = isWin
    ? `Tool: write({"path":${notesPath},"content":"todo\\n"})`
    : `Tool: write({"file_path":${notesPath},"content":"todo\\n"})`;
  const discoveryHint = isWin
    ? `If the visible tool list does not include a needed deferred capability, load it with tool_search instead of assuming it does not exist.
Example:
Tool: tool_search({"query":"glob"})
Tool: glob({"pattern":"src/**/*.ts"})`
    : `glob and grep are always available on Linux/mac. Example:
Tool: glob({"pattern":"src/**/*.ts"})
Tool: grep({"pattern":"loginUser","path":"src"})
Load other deferred tools with tool_search when needed.`;
  const patchToolHint = isWin
    ? `For a large or multi-file code patch, use apply_patch with one escaped patch_text string:
Tool: apply_patch({"patch_text":"*** Begin Patch\\n*** Update File: ${path.join('src', 'auth', 'service.ts').replace(/\\/g, '/')}\\n@@\\n-export const enabled = false;\\n+export const enabled = true;\\n*** End Patch"})`
    : `Prefer edit old_string/new_string for edits (multi-hunk via multiple edit calls).`;
  const sandboxHint = vm
    ? `Shell commands run inside a Linux microVM sandbox (${shellContext.sandbox.mode}); denials include [sandbox: ...] markers.`
    : osConfine
      ? `Shell commands run on the host under OS confinement (${platform === 'darwin' ? 'Seatbelt' : 'Landlock'}, ${shellContext.sandbox.mode}); denials include [sandbox: ...] markers.`
      : '';
  const patchHint = [patchToolHint, sandboxHint].filter(Boolean).join('\n');

  return `# Tool Examples

Use these as style examples for tool calls:

Current working directory: ${vm ? 'project root' : shellContext.commandCwd}
${vm
  ? 'Use project-relative paths such as src/app.ts for both file tools and shell commands. Do not add the sandbox mount path.'
  : `When a tool takes path, build it from the current working directory and prefer absolute paths.\nIf the user mentions a project-relative path like src/app.ts, resolve it from ${cwd} instead of guessing parent directories.`}
Tool arguments must be valid JSON objects. When a string contains file content, encode newlines as \\n inside the JSON string; never put raw unescaped line breaks inside a JSON string.

1. File discovery then read
User: compare the auth flow
Assistant: first narrow the search with the project index
Tool: search_code({"query":"auth flow","path":"src","max_results":3})
${readExample}

${discoveryHint}
To discover or load Codemini skills, use the skill tool directly against the indexed registry:
Tool: skill({"query":"fix ts generic error"})
Tool: skill({"name":"list"})
Tool: skill({"query":"debugging workflow"})
Do not grep or list skills directories to discover skills.

2. Targeted search then exact text edit
User: rename loginUser to signInUser
Assistant: first find the exact occurrences
Tool: grep({"pattern":"loginUser","path":"src"})
${editExample}

${rewriteExample}

3. Read a specific range
User: inspect the reducer around line 120
Assistant: read only the needed range
${rangeReadExample}

4. Write a new file
User: add a notes file
Assistant: write the file directly
${newFileExample}

${patchHint}

Use update_todos for genuinely multi-step work. When the user asks you to remember lasting preferences/interests, call save_memory(scope="user", kind="preference"); for project rules use scope="project" kind="convention"; for reusable learnings use kind="lesson". Do not duplicate an equivalent fact already in Persistent Memory. Load web_fetch or web_search through tool_search when current external information is needed.

Prefer these direct tool shapes over multi-step metadata reads or shell fallbacks.
Prefer explicit absolute path values when the current working directory is known.`;
}

function getEnvBlock(cwd = process.cwd(), config = {}, platform = process.platform) {
  let isGitRepo = false;
  try {
    fs.accessSync(path.join(cwd, '.git'));
    isGitRepo = true;
  } catch {}

  const context = resolveShellContext(config, { cwd, platform });
  const vm = context.sandbox.backend === 'vm';
  const osConfine = context.sandbox.backend === 'os';
  const commandPlatform = vm ? 'linux (Microsandbox guest)' : context.commandPlatform;
  const sandboxLabel = osConfine
    ? `${context.sandbox.mode} (${platform === 'darwin' ? 'Seatbelt' : 'Landlock'})`
    : context.sandbox.mode;

  if (vm) {
    return `<env>
Working directory: project root
Is directory a git repo: ${isGitRepo ? 'Yes' : 'No'}
Platform: ${commandPlatform}
Shell: bash
Network: unrestricted outbound access
Sandbox: ${context.sandbox.mode}
</env>`;
  }

  return `<env>
Working directory: ${cwd}
Is directory a git repo: ${isGitRepo ? 'Yes' : 'No'}
Host platform: ${platform}
Command platform: ${commandPlatform}
Shell: ${context.shell || os.userInfo().shell || 'unknown'}
Shell working directory: ${context.commandCwd}
OS Version: ${os.version || os.release()}
Sandbox: ${sandboxLabel}
</env>`;
}

function getMarkdownImageBlock() {
  return 'This UI renders Markdown images. When you have a public image URL, embed it with `![description](url)`. Never claim you cannot display images. If no direct URL exists, share the page link instead.';
}

function getNaturalWritingBlock() {
  return `# Natural writing

Write plainly, concretely, and in the user's language.

- Lead with the answer, result, or decision. Skip ceremonial openings, generic praise, filler, and restating the request.
- Preserve facts, uncertainty, citations, technical terms, code, numbers, and constraints. Never invent details to make prose feel more vivid or complete.
- Prefer direct sentences, concrete evidence, and simple verbs. Avoid promotional claims, vague authority, inflated significance, forced contrasts, formulaic three-part lists, repetitive section shapes, and generic upbeat conclusions.
- Use only as much structure as the material needs. Avoid excessive headings, bold text, rhetorical questions, and decorative emoji.
- Vary sentence and paragraph rhythm naturally without forcing quirks. Do not add opinions, humor, first-person reactions, anecdotes, or deliberate messiness unless the task or requested voice calls for them.
- Match the genre. Technical, legal, research, and reference writing should remain precise and neutral; conversational and creative writing may carry more personality.
- Explicit user instructions about tone, formatting, terminology, emoji, or voice override these defaults.

Apply these principles silently. Do not announce that text was humanized or describe these rules unless asked.`;
}

function normalizePromptBlocks(blocks) {
  if (!blocks) return [];
  if (Array.isArray(blocks)) return blocks.filter(Boolean).map(String);
  return [String(blocks)].filter(Boolean);
}

export function buildDefaultSystemPrompt(config = {}, options = {}) {
  const cwd = resolvePromptCwd(options);
  const platform = options.platform || process.platform;
  const shellContext = resolveShellContext(config, { cwd, platform });
  return [
    getShellSystemPrompt(shellContext.shell),
    getToolFewShotBlock(config, cwd, platform),
    getNaturalWritingBlock(),
    getMarkdownImageBlock(),
    getEnvBlock(cwd, config, platform),
    ...normalizePromptBlocks(options.extraPrompts)
  ].filter(Boolean).join('\n\n');
}
