import test from 'node:test';
import assert from 'node:assert/strict';
import { isPostCompletionExtrasReady } from '../codemini-web/client/src/lib/message-post-completion.js';
import { embedBannerContentKey } from '../codemini-web/client/src/lib/embed-banner-key.js';

test('finished messages keep related-links ready while a later turn streams', () => {
  assert.equal(
    isPostCompletionExtrasReady({ messageComplete: true, sessionLive: true }),
    true,
  );
  assert.equal(
    isPostCompletionExtrasReady({ messageComplete: true, sessionLive: false }),
    true,
  );
  assert.equal(
    isPostCompletionExtrasReady({ messageComplete: false, sessionLive: false }),
    false,
  );
  assert.equal(
    isPostCompletionExtrasReady({ messageComplete: false, sessionLive: true }),
    false,
  );
});

test('embed banner content key ignores items array identity', () => {
  const a = [
    { type: 'link', url: 'https://a.example' },
    { type: 'link', url: 'https://b.example' },
  ];
  const b = [
    { type: 'link', url: 'https://a.example' },
    { type: 'link', url: 'https://b.example' },
  ];
  assert.notEqual(a, b);
  assert.equal(embedBannerContentKey(a), embedBannerContentKey(b));
  assert.notEqual(
    embedBannerContentKey(a),
    embedBannerContentKey([{ type: 'link', url: 'https://c.example' }]),
  );
});
