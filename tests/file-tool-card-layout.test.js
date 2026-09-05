import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('file read and mutation tool cards share a compact file disclosure row', async () => {
  const source = await fs.readFile(
    'codemini-web/client/src/components/ToolCard.jsx',
    'utf8',
  );
  const css = await fs.readFile('codemini-web/client/style.css', 'utf8');

  assert.match(source, /toolName === "read" && filePath \? \{ path: filePath \} : null/);
  assert.match(source, /fileDisplayMeta && collapsible/);
  assert.match(source, /codemini-file-tool-row/);
  assert.match(source, /function FileToolHeaderMeta/);
  assert.match(source, /<FileTypeIcon[\s\S]*?\{name \|\| "file"\}[\s\S]*?\{dir \?/);
  assert.match(source, /codemini-file-tool-caret/);
  assert.match(source, /text-\(--text-process-hover\)/);
  assert.match(source, /\(\{dir\}\)/);
  assert.match(source, /handleFileAction\(event, "open"\)/);
  assert.match(source, /handleFileAction\(event, "reveal"\)/);
  assert.match(source, /disableFileHeader: true/);
  assert.match(source, /hasFilePreview \? \([\s\S]*?<FilePreview[\s\S]*?<pre className=\{DETAIL_PRE_CLASS\}>\{conversationOutput\}<\/pre>/);
  assert.match(css, /\.codemini-file-tool-body \{[\s\S]*?margin: 2px 4px 6px 32px;/);
  assert.match(css, /\.codemini-file-tool-diff \{[\s\S]*?border-radius: 14px;/);
});
