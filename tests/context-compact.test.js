import test from 'node:test';
import assert from 'node:assert/strict';

import { estimateMessagesTokens } from '../src/core/context-compact.js';

test('estimateMessagesTokens charges non-ascii text more heavily than ascii text', () => {
  const asciiOnly = estimateMessagesTokens([{ role: 'user', content: 'abcdefgh' }]);
  const chineseOnly = estimateMessagesTokens([{ role: 'user', content: '你好世界你好世界' }]);

  assert.equal(asciiOnly, 8);
  assert.equal(chineseOnly, 10);
  assert.ok(chineseOnly > asciiOnly);
});
