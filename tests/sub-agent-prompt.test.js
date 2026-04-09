import test from 'node:test';
import assert from 'node:assert/strict';

import { getSubAgentRolePrompt } from '../src/core/chat-runtime.js';

test('coder sub-agent prompt defines stop conditions and blocked behavior', () => {
  const prompt = getSubAgentRolePrompt('coder');

  assert.match(prompt, /coder in a multi-step agent pipeline/i);
  assert.match(prompt, /Actions Taken:/i);
  assert.match(prompt, /Verified:/i);
  assert.match(prompt, /Open Issues:/i);
  assert.match(prompt, /Do not summarize the goal, recap the plan, or add closing remarks\./i);
});
