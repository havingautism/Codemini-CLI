import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDefaultSystemPrompt } from '../src/core/default-system-prompt.js';

test('buildDefaultSystemPrompt uses workspaceRoot instead of process.cwd()', () => {
  const projectRoot = 'E:\\Git Projects\\demo-app';
  const prompt = buildDefaultSystemPrompt({}, { workspaceRoot: projectRoot });
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

test('buildDefaultSystemPrompt includes compact natural-writing defaults', () => {
  const prompt = buildDefaultSystemPrompt({});

  assert.match(prompt, /# Natural writing/);
  assert.match(prompt, /Never invent details/);
  assert.match(prompt, /Technical, legal, research, and reference writing should remain precise and neutral/);
  assert.match(prompt, /Explicit user instructions about tone, formatting, terminology, emoji, or voice override these defaults/);
  assert.doesNotMatch(prompt, /quality score|\/50|rewrite every problematic passage/i);
});
