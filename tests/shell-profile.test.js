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
  assert.match(prompt, /visible default tool list is intentionally small/i);
  assert.match(prompt, /do not assume it is unavailable/i);
  assert.match(prompt, /Use list for directory-by-directory filesystem discovery/i);
  assert.match(prompt, /load glob with tool_search/i);
  assert.match(prompt, /MUST use it before major tool work/i);
  assert.match(prompt, /Do NOT use it for single-step trivial edits/i);
  assert.match(prompt, /Keep exactly one item in_progress/i);
  assert.match(prompt, /Before giving a completion-style final answer/i);
  assert.match(prompt, /create the todo checklist before the first major implementation or verification tool call/i);
  assert.match(prompt, /run_in_background=true/i);
  assert.match(prompt, /list_background_tasks\/get_background_task/i);
  assert.match(prompt, /output_file/i);
  assert.match(prompt, /remember_user, remember_global, remember_project/i);
  assert.match(prompt, /Load a deferred tool when needed/i);
  assert.match(prompt, /file_path:"src\/app\.ts"/i);
  assert.match(prompt, /old_string:"foo", new_string:"bar"/i);
  assert.match(prompt, /file:"notes\.txt", text:"\.\.\."/i);
  assert.match(prompt, /prefer absolute file_path values rooted there/i);
  assert.match(prompt, /resolve it from the current Working directory/i);
  assert.doesNotMatch(prompt, /Search or read before editing/i);
  assert.doesNotMatch(prompt, /Prefer editing existing files over creating new ones/i);
  assert.doesNotMatch(prompt, /Keep tool results compact in context/i);
});
