import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const [cardSource, messageSource, apiSource] = await Promise.all([
  fs.readFile('codemini-web/client/src/components/HtmlArtifactCard.jsx', 'utf8'),
  fs.readFile('codemini-web/client/src/components/MessageBubble.jsx', 'utf8'),
  fs.readFile('codemini-web/client/src/hooks/use-api.js', 'utf8'),
]);

test('HTML artifact iframe is script-capable but opaque and offline', () => {
  assert.match(cardSource, /sandbox="allow-scripts"/);
  assert.doesNotMatch(cardSource, /allow-same-origin/);
  assert.match(cardSource, /referrerPolicy="no-referrer"/);
  assert.match(cardSource, /loading="lazy"/);
});

test('HTML artifact cards stay visible outside collapsed tool groups', () => {
  assert.match(messageSource, /const htmlArtifactCards = cards\.filter\(isHtmlArtifactCard\)/);
  assert.match(messageSource, /<ToolCard key=\{card\.id\} card=\{card\} collapsible=\{false\} \/>/);
});

test('HTML artifact card has no local disclosure state or collapse control', () => {
  assert.doesNotMatch(cardSource, /\[open, setOpen\]/);
  assert.doesNotMatch(cardSource, /aria-expanded/);
  assert.doesNotMatch(cardSource, /CaretDown/);
});

test('HTML artifact URL is scoped by session and workspace-relative path', () => {
  assert.match(apiSource, /export function buildHtmlArtifactUrl/);
  assert.match(apiSource, /params\.set\('sessionId', sessionId\)/);
  assert.match(apiSource, /params\.set\('path', String\(relativePath/);
  assert.match(apiSource, /\/api\/artifacts\/html\?/);
});
