import test from 'node:test';
import assert from 'node:assert/strict';
import stringWidth from 'string-width';

import { formatMarkdownTableBlock, sanitizeRenderableText } from '../src/tui/chat-app.js';

test('TUI table renderer wraps CJK content within the available width', () => {
  const rows = formatMarkdownTableBlock([
    '| 名称 | 状态 |',
    '| :--- | ---: |',
    '| 很长的中文项目名称 | working |',
  ], 32);

  assert.ok(rows.some((row) => row.isHeader && row.text.includes('名称')));
  assert.ok(rows.every((row) => stringWidth(row.text) <= 32));
});

test('TUI sanitizer delegates ANSI and OSC removal to strip-ansi', () => {
  assert.equal(sanitizeRenderableText('\u001b]0;title\u0007\u001b[32mok\u001b[0m'), 'ok');
});
