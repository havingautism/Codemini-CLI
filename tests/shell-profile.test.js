import test from 'node:test';
import assert from 'node:assert/strict';

import { getShellSystemPrompt } from '../src/core/shell-profile.js';

test('shell system prompt reminds the model it is a CLI coding agent and to send a short progress update before tools', () => {
  const prompt = getShellSystemPrompt('bash');

  assert.match(prompt, /AI coding assistant/i);
  assert.match(prompt, /shares your workspace/i);
  assert.match(prompt, /Before substantial tool work, send a short progress update/i);
  assert.match(prompt, /Do not jump straight into tools without a brief user-facing note/i);
  assert.match(prompt, /Common tool call patterns/i);
  assert.match(prompt, /file_path:"src\/app\.ts"/i);
  assert.match(prompt, /old_string:"foo", new_string:"bar"/i);
  assert.match(prompt, /file:"notes\.txt", text:"\.\.\."/i);
  assert.match(prompt, /prefer absolute file_path values rooted there/i);
  assert.match(prompt, /resolve it from the current Working directory/i);
});
