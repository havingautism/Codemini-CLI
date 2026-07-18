import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('reasoning renders links inline instead of as webpage cards', async () => {
  const source = await fs.readFile(
    'codemini-web/client/src/components/MessageBubble.jsx',
    'utf8',
  );

  const thoughtBlock = source.match(
    /function ThoughtBlock[\s\S]*?function renderInlineMarkdownPreview/,
  )?.[0];

  assert.ok(thoughtBlock, 'ThoughtBlock source should be present');
  assert.match(
    thoughtBlock,
    /<StreamdownRenderer[\s\S]*?inlineEmbeds=\{false\}[\s\S]*?\/>/,
  );
});
