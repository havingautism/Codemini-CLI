import test from 'node:test';
import assert from 'node:assert/strict';

import { appendAttachmentContext } from '../src/core/chat-message.js';

test('chat message appends non-attachment scrapbook context blocks', () => {
  const result = appendAttachmentContext(
    'User question',
    '<scrapbook_context>\nSummary: useful context\n</scrapbook_context>',
  );
  assert.match(result, /User question/);
  assert.match(result, /<scrapbook_context>/);
  assert.match(result, /Summary: useful context/);
});
