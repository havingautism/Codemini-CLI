import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDefaultSystemPrompt } from '../src/core/default-system-prompt.js';

test('default system prompt teaches canonical tool shapes and leaves aliases to runtime repair', () => {
  const prompt = buildDefaultSystemPrompt({ shell: { default: 'bash' } });
  const cwd = process.cwd().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  assert.match(prompt, /# Tool Examples/);
  assert.match(prompt, new RegExp(`Current working directory: ${cwd}`));
  assert.match(prompt, /prefer absolute paths/i);
  assert.match(prompt, /query_project_index\(\{"query":"auth flow","path":"src","max_results":3\}\)/);
  assert.match(prompt, new RegExp(`read\\(\\{"path":"${cwd}\\/src\\/auth\\/service\\.ts"\\}\\)`));
  assert.match(prompt, /tool_search\(\{"query":"glob"\}\)/);
  assert.match(prompt, /glob\(\{"pattern":"src\/\*\*\/\*\.ts"\}\)/);
  assert.match(prompt, /does not include a needed capability/i);
  assert.match(prompt, new RegExp(`read\\(\\{"path":"${cwd}\\/src\\/store\\/reducer\\.ts:110-150"\\}\\)`));
  assert.match(prompt, /query_project_index/i);
  assert.match(prompt, /update_todos\(\{"todos":\[/);
  assert.match(prompt, /do not give a completion-style wrap-up until the checklist is complete or a blocker is recorded/i);
  assert.match(prompt, new RegExp(`edit\\(\\{"path":"${cwd}\\/src\\/auth\\/service\\.ts","old_text":"loginUser","new_text":"signInUser"\\}\\)`));
  assert.match(prompt, new RegExp(`write\\(\\{"path":"${cwd}\\/notes\\.txt","content":"todo\\\\n"\\}\\)`));
  assert.doesNotMatch(prompt, /file_path/);
  assert.doesNotMatch(prompt, /old_string/);
  assert.doesNotMatch(prompt, /new_string/);
  assert.match(prompt, /tool_search\(\{"query":"web_fetch"\}\)/);
  assert.match(prompt, /web_fetch\(\{"url":"https:\/\/example\.com\/docs"\}\)/);
  assert.match(prompt, /tool_search\(\{"query":"web_search"\}\)/);
  assert.match(prompt, /web_search\(\{"query":"latest pnpm release","max_results":5\}\)/);
});
