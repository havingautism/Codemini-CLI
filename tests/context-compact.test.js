import test from 'node:test';
import assert from 'node:assert/strict';

import { compactMessagesLocally, estimateMessagesTokens } from '../src/core/context-compact.js';

test('estimateMessagesTokens charges non-ascii text more heavily than ascii text', () => {
  const asciiOnly = estimateMessagesTokens([{ role: 'user', content: 'abcdefgh' }]);
  const chineseOnly = estimateMessagesTokens([{ role: 'user', content: '你好世界你好世界' }]);

  assert.equal(asciiOnly, 8);
  assert.equal(chineseOnly, 10);
  assert.ok(chineseOnly > asciiOnly);
});

test('compactMessagesLocally produces a structured summary that preserves work state', () => {
  const messages = [
    { role: 'user', content: 'Fix login bug and run tests' },
    { role: 'assistant', content: 'I will inspect auth first.', tool_calls: [{ id: '1' }] },
    { role: 'user', content: 'Keep the API stable.' },
    { role: 'tool', content: JSON.stringify({ path: 'src/auth.js', action: 'edit', changed_line: 12 }) },
    { role: 'tool', content: JSON.stringify({ command: 'npm test', code: 1, stderr: 'login.test.js failed' }) },
    { role: 'assistant', content: 'Need to adjust token parsing.' },
    { role: 'assistant', content: 'Continuing with a minimal fix.' },
    { role: 'tool', content: 'src/auth.js:12: parseToken' },
    { role: 'assistant', content: 'Tests are next.' }
  ];

  const result = compactMessagesLocally(messages, { mode: 'aggressive' });

  assert.equal(result.changed, true);
  assert.match(result.summary, /Context Summary/);
  assert.match(result.summary, /Goal:/);
  assert.match(result.summary, /Key Constraints:/);
  assert.match(result.summary, /Changed Files:/);
  assert.match(result.summary, /Verification:/);
  assert.match(result.summary, /Open Threads:/);
  assert.match(result.summary, /Fix login bug and run tests/);
  assert.match(result.summary, /src\/auth\.js/);
  assert.match(result.summary, /npm test/);
  assert.match(result.summary, /Keep the API stable/);
});
