import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildDefaultSystemPrompt } from '../src/core/default-system-prompt.js';

test('buildDefaultSystemPrompt uses workspaceRoot instead of process.cwd()', () => {
  const projectRoot = 'E:\\Git Projects\\demo-app';
  const resolvedRoot = path.resolve(projectRoot);
  const escapedRoot = resolvedRoot.replace(/[\\.^$*+?()[\]{}|]/g, '\\$&');
  const prompt = buildDefaultSystemPrompt({ sandbox: { enabled: false } }, { workspaceRoot: projectRoot });
  assert.match(prompt, new RegExp(`Working directory: ${escapedRoot}`, 'i'));
  assert.match(prompt, new RegExp(`Current working directory: ${escapedRoot}`, 'i'));
  assert.doesNotMatch(
    prompt,
    /codemini-global[\\/]+workspace/i,
  );
});

test('buildDefaultSystemPrompt tells the model to embed Markdown images', () => {
  const prompt = buildDefaultSystemPrompt({});
  assert.match(prompt, /This UI renders Markdown images/);
  assert.match(prompt, /!\[description\]\(url\)/);
  assert.match(prompt, /Never claim you cannot display images/);
});

test('OS confinement prompt keeps the host cwd and Seatbelt or Landlock', () => {
  const prompt = buildDefaultSystemPrompt({
    shell: { default: 'bash' },
    sandbox: { enabled: true, mode: 'workspace-write', backend: 'os' },
  }, { workspaceRoot: process.cwd(), platform: 'darwin' });
  assert.match(prompt, /OS confinement \(Seatbelt, workspace-write\)/);
  assert.match(prompt, /Sandbox: workspace-write \(Seatbelt\)/);
  assert.match(prompt, new RegExp(`Working directory: ${process.cwd().replace(/[\\.^$*+?()[\]{}|]/g, '\\$&')}`));
  assert.doesNotMatch(prompt, /Microsandbox guest/);
  assert.doesNotMatch(prompt, /Use project-relative paths/i);
});

test('sandboxed prompt presents the Linux guest command environment', () => {
  const prompt = buildDefaultSystemPrompt({
    shell: { default: 'bash' },
    sandbox: { enabled: true, mode: 'workspace-write', backend: 'microsandbox' },
  }, { workspaceRoot: process.cwd() });
  assert.match(prompt, /Platform: linux \(Microsandbox guest\)/);
  assert.match(prompt, /Working directory: project root/);
  assert.doesNotMatch(prompt, /Working directory: \/workspace/);
  assert.match(prompt, /Network: unrestricted outbound access/);
});

test('Windows prompt follows sandbox state instead of the host platform alone', () => {
  const confined = buildDefaultSystemPrompt({
    shell: { default: 'powershell' },
    sandbox: { enabled: true, mode: 'workspace-write', backend: 'microsandbox' },
  }, { workspaceRoot: process.cwd(), platform: 'win32' });
  assert.match(confined, /Bash coding guidelines/);
  assert.match(confined, /Platform: linux \(Microsandbox guest\)/);
  assert.match(confined, /Host platform: win32/);
  assert.match(confined, /Shell: bash/);
  assert.match(confined, /Sandbox: workspace-write/);
  assert.doesNotMatch(confined, /PowerShell coding guidelines/);
  assert.doesNotMatch(confined, /OS Version:|E:\\\\/i);
  assert.match(confined, /Windows host.+Linux microVM/i);
  assert.match(confined, /native dependencies.+OS\/ABI mismatch/i);
  assert.match(confined, /sandbox_permissions.+danger-full-access/i);
  assert.match(confined, /Windows PowerShell/i);
  assert.match(confined, /ordinary code failures/i);
  assert.match(confined, /missing project dependencies/i);
  assert.match(confined, /timeouts/i);
  assert.match(confined, /Current working directory: project root/);
  assert.match(confined, /"file_path":"src\/auth\/service\.ts"/);
  assert.match(confined, /old_string/);
  assert.doesNotMatch(confined, /apply_patch|begin_write/);
  assert.match(confined, /Use project-relative paths/i);
  assert.doesNotMatch(confined, /\/workspace/);

  const unrestricted = buildDefaultSystemPrompt({
    shell: { default: 'bash' },
    sandbox: { enabled: true, mode: 'danger-full-access' },
  }, { workspaceRoot: process.cwd(), platform: 'win32' });
  assert.match(unrestricted, /PowerShell coding guidelines/);
  assert.match(unrestricted, /Command platform: win32/);
  assert.match(unrestricted, /Shell: powershell/);
  assert.match(unrestricted, /Sandbox: danger-full-access/);
  assert.doesNotMatch(unrestricted, /Linux microVM sandbox/);

  const disabled = buildDefaultSystemPrompt({
    shell: { default: 'bash' },
    sandbox: { enabled: false, mode: 'workspace-write' },
  }, { workspaceRoot: process.cwd(), platform: 'win32' });
  assert.match(disabled, /PowerShell coding guidelines/);
  assert.match(disabled, /Host platform: win32/);
  assert.match(disabled, /Command platform: win32/);
  assert.match(disabled, /Shell: powershell/);
  assert.match(disabled, /Sandbox: danger-full-access/);
  assert.doesNotMatch(disabled, /Linux microVM sandbox|Working directory: \/workspace|Bash coding guidelines/);
  assert.match(disabled, /"path":/);
  assert.match(disabled, /apply_patch/);
});

test('tool guidance follows command platform and sandbox backend across host types', () => {
  const linuxDirect = buildDefaultSystemPrompt({
    shell: { default: 'bash' },
    sandbox: { enabled: false },
  }, { workspaceRoot: process.cwd(), platform: 'linux' });
  assert.match(linuxDirect, /Bash coding guidelines/);
  assert.match(linuxDirect, /"file_path":/);
  assert.match(linuxDirect, /No filesystem sandbox is active/);
  assert.doesNotMatch(linuxDirect, /apply_patch|staged writes only/);

  const linuxConfined = buildDefaultSystemPrompt({
    shell: { default: 'bash' },
    sandbox: { enabled: true, mode: 'read-only', backend: 'os' },
  }, { workspaceRoot: process.cwd(), platform: 'linux' });
  assert.match(linuxConfined, /OS confinement \(Landlock, read-only\)/);
  assert.match(linuxConfined, /sandbox is read-only/i);
  assert.match(linuxConfined, /use host paths/i);

  const windowsDirect = buildDefaultSystemPrompt({
    shell: { default: 'bash' },
    sandbox: { enabled: false },
  }, { workspaceRoot: process.cwd(), platform: 'win32' });
  assert.match(windowsDirect, /PowerShell coding guidelines/);
  assert.match(windowsDirect, /"path":/);
  assert.match(windowsDirect, /apply_patch/);
  assert.doesNotMatch(windowsDirect, /"file_path":/);
});

test('buildDefaultSystemPrompt includes compact natural-writing defaults', () => {
  const prompt = buildDefaultSystemPrompt({});

  assert.match(prompt, /# Natural writing/);
  assert.match(prompt, /Never invent details/);
  assert.match(prompt, /Technical, legal, research, and reference writing should remain precise and neutral/);
  assert.match(prompt, /Explicit user instructions about tone, formatting, terminology, emoji, or voice override these defaults/);
  assert.doesNotMatch(prompt, /quality score|\/50|rewrite every problematic passage/i);
});

test('buildDefaultSystemPrompt stays compact enough for layered turn context', () => {
  const prompt = buildDefaultSystemPrompt({}, { workspaceRoot: process.cwd() });
  assert.ok(prompt.length < 5000, `default prompt grew to ${prompt.length} characters`);
});
