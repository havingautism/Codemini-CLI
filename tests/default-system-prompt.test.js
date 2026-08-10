import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDefaultSystemPrompt } from '../src/core/default-system-prompt.js';

test('buildDefaultSystemPrompt uses workspaceRoot instead of process.cwd()', () => {
  const projectRoot = 'E:\\Git Projects\\demo-app';
  const prompt = buildDefaultSystemPrompt({ sandbox: { enabled: false } }, { workspaceRoot: projectRoot });
  assert.match(prompt, /Working directory: E:\\Git Projects\\demo-app/i);
  assert.match(prompt, /Current working directory: E:\\Git Projects\\demo-app/i);
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

test('sandboxed prompt presents only the Linux guest environment', () => {
  const prompt = buildDefaultSystemPrompt({
    shell: { default: 'bash' },
    sandbox: { enabled: true, mode: 'workspace-write' },
  }, { workspaceRoot: process.cwd() });
  assert.match(prompt, /Platform: linux \(Microsandbox guest\)/);
  assert.match(prompt, /Working directory: project root/);
  assert.doesNotMatch(prompt, /Working directory: \/workspace/);
  assert.match(prompt, /Network: unrestricted outbound access/);
});

test('Windows prompt follows sandbox state instead of the host platform alone', () => {
  const confined = buildDefaultSystemPrompt({
    shell: { default: 'powershell' },
    sandbox: { enabled: true, mode: 'workspace-write' },
  }, { workspaceRoot: process.cwd(), platform: 'win32' });
  assert.match(confined, /Bash coding guidelines/);
  assert.match(confined, /Platform: linux \(Microsandbox guest\)/);
  assert.match(confined, /Shell: bash/);
  assert.match(confined, /Sandbox: workspace-write/);
  assert.doesNotMatch(confined, /PowerShell coding guidelines/);
  assert.doesNotMatch(confined, /Host platform:|OS Version:|E:\\\\/i);
  assert.match(confined, /Current working directory: project root/);
  assert.match(confined, /"path":"src\/auth\/service\.ts"/);
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
});

test('buildDefaultSystemPrompt includes compact natural-writing defaults', () => {
  const prompt = buildDefaultSystemPrompt({});

  assert.match(prompt, /# Natural writing/);
  assert.match(prompt, /Never invent details/);
  assert.match(prompt, /Technical, legal, research, and reference writing should remain precise and neutral/);
  assert.match(prompt, /Explicit user instructions about tone, formatting, terminology, emoji, or voice override these defaults/);
  assert.doesNotMatch(prompt, /quality score|\/50|rewrite every problematic passage/i);
});
