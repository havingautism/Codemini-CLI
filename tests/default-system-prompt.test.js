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
