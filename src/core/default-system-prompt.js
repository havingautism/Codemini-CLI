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
  const notesPath = toolPath('notes.txt');
  const isWin = shellContext.commandPlatform === 'win32';
  const editExample = isWin
    ? `Tool: edit({"path":${authServicePath},"old_text":"loginUser","new_text":"signInUser"})`
    : `Tool: edit({"file_path":${authServicePath},"old_string":"loginUser","new_string":"signInUser"})`;
  const readExample = isWin
    ? `Tool: read({"path":${authServicePath}})`
    : `Tool: read({"file_path":${authServicePath}})`;
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
  const accessRule = shellContext.sandbox.mode === 'read-only'
    ? 'The sandbox is read-only: inspect and verify only. Request wider sandbox permissions with a justification only when the user explicitly authorized a mutation.'
    : shellContext.sandbox.mode === 'workspace-write'
      ? 'Writes are confined to the project workspace and temporary directory. Request wider sandbox permissions with a justification only when the task explicitly requires access outside them.'
      : 'No filesystem sandbox is active. Keep writes and destructive commands narrowly scoped to the user request.';
  const sandboxHint = vm
    ? `Shell commands run inside a Linux microVM sandbox (${shellContext.sandbox.mode}); use project-relative paths and treat [sandbox: ...] errors as confinement failures. ${accessRule}`
    : osConfine
      ? `Shell commands run on the host under OS confinement (${platform === 'darwin' ? 'Seatbelt' : 'Landlock'}, ${shellContext.sandbox.mode}); use host paths and treat [sandbox: ...] errors as confinement failures. ${accessRule}`
      : `Shell commands run directly on the host. ${accessRule}`;
  const patchHint = [patchToolHint, sandboxHint].filter(Boolean).join('\n');

  return `# Tool call examples
Current working directory: ${vm ? 'project root' : shellContext.commandCwd}
${vm
  ? 'Use project-relative paths such as src/app.ts; never add a sandbox mount path.'
  : `Resolve project-relative paths from ${cwd}; prefer absolute paths when available.`}
Tool arguments must be valid JSON; escape newlines inside string values.

Tool: search_code({"query":"auth flow","path":"src","max_results":3})
${readExample}
${editExample}
${newFileExample}

${discoveryHint}
Use skill({"query":"workflow"}) for skill discovery instead of scanning skill directories.
For non-trivial work, send the full checklist each time (whole list replaces the previous one):
Tool: tasks({"tasks":[{"content":"Inspect relevant code","status":"in_progress"},{"content":"Run focused verification","status":"pending"}]})
${patchHint}`;
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
Write plainly in the user's language. Lead with the result; avoid filler and unnecessary structure.
Preserve facts, uncertainty, citations, code, numbers, and constraints. Never invent details.
Technical, legal, research, and reference writing should remain precise and neutral.
Explicit user instructions about tone, formatting, terminology, emoji, or voice override these defaults.`;
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
