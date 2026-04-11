import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDefaultSystemPrompt } from '../src/core/default-system-prompt.js';

test('default system prompt includes demo-style tool few-shot examples', () => {
  const prompt = buildDefaultSystemPrompt({ shell: { default: 'bash' } });
  const cwd = process.cwd().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  assert.match(prompt, /# Tool Examples/);
  assert.match(prompt, new RegExp(`Current working directory: ${cwd}`));
  assert.match(prompt, /prefer absolute paths/i);
  assert.match(prompt, /query_project_index\(\{"query":"auth flow","path":"src","max_results":3\}\)/);
  assert.match(prompt, new RegExp(`read\\(\\{"file_path":"${cwd}\\/src\\/auth\\/service\\.ts"\\}\\)`));
  assert.match(prompt, /tool_search\(\{"query":"glob"\}\)/);
  assert.match(prompt, /glob\(\{"pattern":"src\/\*\*\/\*\.ts"\}\)/);
  assert.match(prompt, /does not include a needed capability/i);
  assert.match(prompt, new RegExp(`read\\(\\{"path":"${cwd}\\/src\\/store\\/reducer\\.ts:110-150"\\}\\)`));
  assert.match(prompt, /query_project_index/i);
  assert.match(prompt, /update_todos\(\{"todos":\[/);
  assert.match(prompt, /do not give a completion-style wrap-up until the checklist is complete or a blocker is recorded/i);
  assert.match(prompt, new RegExp(`edit\\(\\{"file_path":"${cwd}\\/src\\/auth\\/service\\.ts","old_string":"loginUser","new_string":"signInUser"\\}\\)`));
  assert.match(prompt, new RegExp(`write\\(\\{"file":"${cwd}\\/notes\\.txt","text":"todo\\\\n"\\}\\)`));
  assert.match(prompt, /tool_search\(\{"query":"web_fetch"\}\)/);
  assert.match(prompt, /web_fetch\(\{"url":"https:\/\/example\.com\/docs"\}\)/);
  assert.match(prompt, /tool_search\(\{"query":"web_search"\}\)/);
  assert.match(prompt, /web_search\(\{"query":"latest pnpm release","max_results":5\}\)/);
});
