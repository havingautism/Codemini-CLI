import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('streaming messages use memoized bubbles and primitive context subscriptions', async () => {
  const [bubbleSource, contextSource, appSource] = await Promise.all([
    fs.readFile('codemini-web/client/src/components/MessageBubble.jsx', 'utf8'),
    fs.readFile('codemini-web/client/src/context/app-context.jsx', 'utf8'),
    fs.readFile('codemini-web/client/src/App.jsx', 'utf8'),
  ]);

  assert.match(bubbleSource, /export const MessageBubble = memo\(/);
  assert.doesNotMatch(bubbleSource, /\buseApp\(/);
  assert.match(contextSource, /export function useRuntimeMode\(/);
  assert.match(contextSource, /export function useCurrentSessionId\(/);
  assert.match(appSource, /const retryMessage = useCallback\(/);
  assert.match(appSource, /onRetryMessage=\{retryMessage\}/);
});
