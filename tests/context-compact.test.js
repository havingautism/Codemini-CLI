import test from 'node:test';
import assert from 'node:assert/strict';

import { compactMessagesLocally, estimateMessagesTokens, microCompactMessages, parseCompactArgs } from '../src/core/context-compact.js';

test('estimateMessagesTokens charges non-ascii text more heavily than ascii text', () => {
  const asciiOnly = estimateMessagesTokens([{ role: 'user', content: 'abcdefgh' }]);
  const chineseOnly = estimateMessagesTokens([{ role: 'user', content: '你好世界你好世界' }]);

  assert.equal(asciiOnly, 8);
  assert.equal(chineseOnly, 10);
  assert.ok(chineseOnly > asciiOnly);
});

test('compactMessagesLocally produces a structured summary that preserves work state', async () => {
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

  const result = await compactMessagesLocally(messages, { mode: 'aggressive' });

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

test('microCompactMessages clears old tool results, keeps recent ones', () => {
  const messages = [
    { role: 'user', content: 'start' },
    { role: 'tool', content: 'tool result 1 with lots of text content that uses tokens' },
    { role: 'assistant', content: 'ok' },
    { role: 'tool', content: 'tool result 2 with lots of text content that uses tokens' },
    { role: 'assistant', content: 'ok' },
    { role: 'tool', content: 'tool result 3 with lots of text content that uses tokens' },
    { role: 'assistant', content: 'done' }
  ];

  const result = microCompactMessages(messages, { keepRecent: 1 });

  assert.equal(result.changed, true);
  assert.ok(result.tokensSaved > 0);
  // First two tool results should be cleared
  assert.ok(result.messages[1].content.includes('[Old tool result cleared by micro-compact]'));
  assert.ok(result.messages[3].content.includes('[Old tool result cleared by micro-compact]'));
  // Last tool result should be kept
  assert.equal(result.messages[5].content, 'tool result 3 with lots of text content that uses tokens');
  // Message count unchanged
  assert.equal(result.messages.length, messages.length);
});

test('microCompactMessages does nothing when tool results <= keepRecent', () => {
  const messages = [
    { role: 'tool', content: 'only tool result' },
    { role: 'assistant', content: 'done' }
  ];

  const result = microCompactMessages(messages, { keepRecent: 5 });

  assert.equal(result.changed, false);
  assert.equal(result.tokensSaved, 0);
  assert.equal(result.messages[0].content, 'only tool result');
});

test('microCompactMessages respects enabled=false', () => {
  const messages = [
    { role: 'tool', content: 'result 1' },
    { role: 'tool', content: 'result 2' },
    { role: 'tool', content: 'result 3' }
  ];

  const result = microCompactMessages(messages, { keepRecent: 1, enabled: false });

  assert.equal(result.changed, false);
  assert.equal(result.tokensSaved, 0);
});

test('microCompactMessages does not re-clear already cleared results', () => {
  const messages = [
    { role: 'tool', content: '[Old tool result cleared by micro-compact]' },
    { role: 'tool', content: 'real content here' }
  ];

  const result = microCompactMessages(messages, { keepRecent: 1 });

  assert.equal(result.changed, false);
});

test('parseCompactArgs parses --micro flag', () => {
  const args = parseCompactArgs(['--micro']);
  assert.equal(args.micro, true);
  assert.equal(args.mode, 'default');
  assert.equal(args.preview, false);
});

test('parseCompactArgs parses --micro with --preview', () => {
  const args = parseCompactArgs(['--micro', '--preview']);
  assert.equal(args.micro, true);
  assert.equal(args.preview, true);
});
