import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { buildDefaultSystemPrompt } from '../src/core/default-system-prompt.js';
import { composeSystemPrompt } from '../src/core/system-prompt-composer.js';

test('default system prompt teaches canonical tool shapes and leaves aliases to runtime repair', () => {
  const prompt = buildDefaultSystemPrompt({ shell: { default: 'bash' } });
  const cwd = process.cwd().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  assert.match(prompt, /# Tool Examples/);
  assert.match(prompt, new RegExp(`Current working directory: ${cwd}`));
  assert.match(prompt, /prefer absolute paths/i);
  assert.match(prompt, /query_project_index\(\{"query":"auth flow","path":"src","max_results":3\}\)/);
  const authServiceJson = JSON.stringify(path.join(process.cwd(), 'src', 'auth', 'service.ts'));
  const reducerRangeJson = JSON.stringify(`${path.join(process.cwd(), 'src', 'store', 'reducer.ts')}:110-150`);
  const notesJson = JSON.stringify(path.join(process.cwd(), 'notes.txt'));
  assert.ok(prompt.includes(`read({"path":${authServiceJson}})`));
  assert.match(prompt, /tool_search\(\{"query":"glob"\}\)/);
  assert.match(prompt, /glob\(\{"pattern":"src\/\*\*\/\*\.ts"\}\)/);
  assert.match(prompt, /does not include a needed capability/i);
  assert.ok(prompt.includes(`read({"path":${reducerRangeJson}})`));
  assert.match(prompt, /query_project_index/i);
  assert.match(prompt, /update_todos\(\{"todos":\[/);
  assert.match(prompt, /do not give a completion-style wrap-up until the checklist is complete or a blocker is recorded/i);
  assert.ok(prompt.includes(`edit({"path":${authServiceJson},"old_text":"loginUser","new_text":"signInUser"})`));
  assert.ok(prompt.includes(`write({"path":${notesJson},"content":"todo\\n"})`));
  assert.doesNotMatch(prompt, /file_path/);
  assert.doesNotMatch(prompt, /old_string/);
  assert.doesNotMatch(prompt, /new_string/);
  assert.match(prompt, /tool_search\(\{"query":"web_fetch"\}\)/);
  assert.match(prompt, /web_fetch\(\{"url":"https:\/\/example\.com\/docs"\}\)/);
  assert.match(prompt, /tool_search\(\{"query":"web_search"\}\)/);
  assert.match(prompt, /web_search\(\{"query":"latest pnpm release","max_results":5\}\)/);
});

test('composeSystemPrompt keeps reply language last and avoids duplicate directives', async () => {
  const prompt = await composeSystemPrompt({
    shellRulesPrompt: 'Shell rules\n\n[Reply language]\nRespond in English.\nWrite generated documentation, user-facing text, and code comments in English unless the user explicitly asks for a different language.',
    config: { ui: { reply_language: 'en' }, memory: { enabled: false } },
    includeMemory: false,
    skillsPrompt: '[Auto skill: demo]\nSkill body',
    projectContextSnippet: 'Project context',
    projectContextGuidance: 'Verify project context'
  });

  assert.equal((prompt.match(/\[Reply language\]/g) || []).length, 1);
  assert.ok(prompt.indexOf('Shell rules') < prompt.indexOf('[Soul preset:'));
  assert.ok(prompt.indexOf('[Auto skill: demo]') < prompt.indexOf('Project context'));
  assert.ok(prompt.indexOf('Project context') < prompt.indexOf('[Reply language]'));
  assert.match(prompt.trim().split('\n').at(-2), /Respond in English/);
});
