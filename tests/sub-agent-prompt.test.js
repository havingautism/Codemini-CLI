import test from 'node:test';
import assert from 'node:assert/strict';

import { getSubAgentRolePrompt } from '../src/core/chat-runtime.js';

test('coder sub-agent prompt defines stop conditions and blocked behavior', () => {
  const prompt = getSubAgentRolePrompt('coder');

  assert.match(prompt, /execution sub-agent/i);
  assert.match(prompt, /Stop when: you have produced the code change and verified it compiles\/passes basic checks\./i);
  assert.match(prompt, /If blocked: report what blocked you and what you tried, then stop\./i);
});
