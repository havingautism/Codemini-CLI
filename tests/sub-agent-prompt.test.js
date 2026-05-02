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

test('advisor sub-agent prompt defines advisory output without implementation authority', () => {
  const prompt = getSubAgentRolePrompt('advisor');

  assert.match(prompt, /advisor in a multi-step agent pipeline/i);
  assert.match(prompt, /Do not edit files, write code, delete files, or run commands/i);
  assert.match(prompt, /Recommendations:/i);
  assert.match(prompt, /Tradeoffs:/i);
  assert.match(prompt, /Evidence:/i);
  assert.match(prompt, /Open Questions:/i);
});
