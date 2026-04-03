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
  assert.match(prompt, new RegExp(`read\\(\\{"path":"${cwd}\\/src\\/store\\/reducer\\.ts:110-150"\\}\\)`));
  assert.match(prompt, /query_project_index/i);
  assert.match(prompt, new RegExp(`edit\\(\\{"file_path":"${cwd}\\/src\\/auth\\/service\\.ts","old_string":"loginUser","new_string":"signInUser"\\}\\)`));
  assert.match(prompt, new RegExp(`write\\(\\{"file":"${cwd}\\/notes\\.txt","text":"todo\\\\n"\\}\\)`));
});
