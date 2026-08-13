import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('scrapbook summary prompt asks for comprehensive detailed output', async () => {
  const source = await fs.readFile('codemini-web/lib/scrapbook-service.js', 'utf8');
  assert.match(source, /detailed note summary|briefing/i);
  assert.match(source, /key facts/i);
  assert.match(source, /actionable takeaways/i);
  assert.match(source, /important context|important details|structure/i);
  assert.match(source, /markdown image references|images/i);
  assert.doesNotMatch(source, /<uploaded_attachments>/);
});
