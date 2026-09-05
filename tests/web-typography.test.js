import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const style = fs.readFileSync(
  path.join(root, 'codemini-web', 'client', 'style.css'),
  'utf8',
);
const i18n = fs.readFileSync(
  path.join(root, 'codemini-web', 'client', 'i18n', 'index.js'),
  'utf8',
);

test('web typography uses one UI stack and one code stack', () => {
  assert.match(
    style,
    /--font-ui:\s*"Inter Variable",\s*"Noto Sans SC Variable"/,
  );
  assert.match(style, /--font-code:\s*"Geist Mono"/);
  assert.match(style, /--font-sans:\s*var\(--font-ui\)/);
  assert.match(style, /--font-mono:\s*var\(--font-code\)/);
  assert.doesNotMatch(style, /--font-sans:\s*-apple-system/);
  assert.doesNotMatch(style, /font-family:\s*"Geist"/);
});

test('chat prose keeps stable Windows metrics and neutral body tracking', () => {
  assert.match(
    style,
    /\.msg-body\.codemini-assistant-markdown\s*\{[^}]*font-size:\s*15px;[^}]*line-height:\s*1\.7;[^}]*letter-spacing:\s*normal;/s,
  );
  assert.match(style, /font-optical-sizing:\s*auto;/);
});

test('inline terms use the UI face while real code blocks remain monospaced', () => {
  assert.match(
    style,
    /\.msg-body :not\(pre\)>code\s*\{[^}]*font-family:\s*var\(--font-sans\);[^}]*font-weight:\s*500;/s,
  );
  assert.match(
    style,
    /\.msg-body \[data-streamdown="code-block-body"\] pre\s*\{[^}]*font-family:\s*var\(--font-mono\)\s*!important;/s,
  );
});

test('UI locale updates the document language for typography and accessibility', () => {
  assert.match(i18n, /document\.documentElement\.lang\s*=\s*locale === 'zh' \? 'zh-CN' : 'en'/);
  assert.match(i18n, /syncDocumentLocale\(current\)/);
  assert.match(i18n, /syncDocumentLocale\(locale\)/);
});
