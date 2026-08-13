import test from 'node:test';
import assert from 'node:assert/strict';
import { embedBannerContentKey } from '../codemini-web/client/src/lib/embed-banner-key.js';

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
