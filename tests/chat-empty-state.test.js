import test from 'node:test';
import assert from 'node:assert/strict';

import { hasConversationContent } from '../codemini-web/client/src/lib/chat-empty-state.js';

test('startup Hook metadata does not suppress the project welcome page', () => {
  const startupHookMessage = {
    id: 'startup-hooks-session',
    role: 'system',
    segments: [
      {
        type: 'skill',
        kind: 'hook',
        event: 'SessionStart',
        name: 'SessionStart::Ponytail::startup|resume|clear|compact',
        status: 'done',
      },
    ],
  };

  assert.equal(hasConversationContent([startupHookMessage]), false);
  assert.equal(
    hasConversationContent([startupHookMessage, { role: 'you', text: 'hello' }]),
    true,
  );
});
