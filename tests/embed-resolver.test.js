import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveEmbed } from '../codemini-web/lib/embed-resolver.js';

test('generic embed metadata uses HTML parsing instead of attribute-order regexes', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(`<!doctype html>
    <html><head>
      <title>Fallback &amp; title</title>
      <meta content="Parsed &amp; title" property="og:title">
      <meta content="A useful description" name="description">
      <link href="/preview.png" rel="image_src">
    </head></html>`, { status: 200 });

  const result = await resolveEmbed('https://example.com/metadata-order-test');

  assert.equal(result.title, 'Parsed & title');
  assert.equal(result.description, 'A useful description');
  assert.equal(result.image, 'https://example.com/preview.png');
});
