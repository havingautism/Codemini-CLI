import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { hasConversationContent, isSupersededWaitingResponse } from '../codemini-web/client/src/lib/chat-empty-state.js';

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

test('waiting-response is a dots loader and disappears once General starts rendering', async () => {
  const source = await fs.readFile(
    'codemini-web/client/src/components/MessageBubble.jsx',
    'utf8',
  );
  const start = source.indexOf('transientKey === "waiting-response"');
  assert.ok(start >= 0, 'waiting-response branch must exist');
  const slice = source.slice(start, start + 800);
  assert.match(slice, /<Spinner/);
  assert.doesNotMatch(
    slice,
    /ROLE_STYLES\.general/,
    'waiting-response must not render a General label of its own',
  );

  const panel = await fs.readFile(
    'codemini-web/client/src/components/ChatPanel.jsx',
    'utf8',
  );
  assert.match(panel, /isSupersededWaitingResponse/);

  const waiting = {
    id: 'wait-1',
    role: 'system',
    transientKey: 'waiting-response',
  };
  const general = { id: 'answer-1', role: 'general', segments: [] };
  assert.equal(
    isSupersededWaitingResponse([{ id: 'you-1', role: 'you' }, waiting], 1),
    false,
  );
  assert.equal(
    isSupersededWaitingResponse(
      [{ id: 'you-1', role: 'you' }, waiting, general],
      1,
    ),
    true,
  );
});

test('waiting loaders stop when no turn is running, so dead streams do not spin forever', async () => {
  const source = await fs.readFile(
    'codemini-web/client/src/components/MessageBubble.jsx',
    'utf8',
  );

  const fallbackLoader = source.slice(
    source.indexOf('turnActive &&'),
    source.indexOf('turnActive &&') + 300,
  );
  assert.match(
    fallbackLoader,
    /turnActive &&\s*renderGroups\.length === 0\s*&&\s*!messageComplete/,
    'fallback loader must be gated on an active turn',
  );

  const streamingStrip = source.slice(
    source.indexOf('const groups = buildRenderGroups(segments || []).map'),
    source.indexOf('const groups = buildRenderGroups(segments || []).map') +
      500,
  );
  assert.match(
    streamingStrip,
    /group\.type === "text" && group\.isStreaming && !turnActive/,
    'streaming text from a dead stream must be settled when no turn is active',
  );
});
