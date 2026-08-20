import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

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

test('empty session uses a CSS aurora that unmounts once conversation starts', async () => {
  const visual = await fs.readFile(
    'codemini-web/client/src/components/HomeEmptyVisual.jsx',
    'utf8',
  );
  const panel = await fs.readFile(
    'codemini-web/client/src/components/ChatPanel.jsx',
    'utf8',
  );
  const css = await fs.readFile('codemini-web/client/style.css', 'utf8');

  assert.match(visual, /codemini-home-aurora/);
  assert.doesNotMatch(visual, /GeminiLightStrips|codemini-gemini-canvas/);
  assert.doesNotMatch(
    visual,
    /pickHomeEmptyVisual/,
    'aurora should follow theme tokens instead of random palettes',
  );

  const emptyOverlay = panel.slice(
    panel.indexOf('{!messagesLoading && !hasConversation && ('),
    panel.indexOf('<MessageScroller>'),
  );
  assert.match(emptyOverlay, /<HomeEmptyVisual/);
  assert.doesNotMatch(
    panel.slice(panel.indexOf('<MessageScroller>')),
    /<HomeEmptyVisual/,
    'aurora must not stay mounted after messages render',
  );

  assert.match(css, /@keyframes\s+codemini-aurora/);
  assert.match(
    css,
    /prefers-reduced-motion: reduce[\s\S]*codemini-home-aurora/,
  );
});
