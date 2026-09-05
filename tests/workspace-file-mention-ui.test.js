import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('workspace file mentions expose responsive search and file-first result rows', async () => {
  const source = await fs.readFile(
    'codemini-web/client/src/components/InputBar.jsx',
    'utf8',
  );

  assert.match(source, /parseComposerMentionQuery\(val, cursor\)/);
  assert.match(source, /workspaceSearchRequestRef/);
  assert.match(source, /workspaceFilesLoading/);
  assert.match(source, /workspaceFilesError/);
  assert.match(source, /<FileTypeIcon path=\{item\.path\} size="sm" \/>/);
  assert.match(source, /\(\{item\.dir\}\)/);
  assert.match(source, /workspaceFilePickerHint/);
  assert.match(source, /formatComposerFileMention\(item\.path\)/);
  assert.match(source, /referencedFiles\.map\(\(item\) =>/);
  assert.match(
    source,
    /removeComposerMentionToken\(\s*current,\s*mentionCursorRef\.current,?\s*\)/,
  );
  assert.match(source, /setReferencedFiles\(\[\]\)/);
  assert.match(source, /removeReferencedFile/);
  assert.match(source, /referencedFiles\.length > 0/);
  assert.match(source, /disabled=\{!hasComposerContent \|\| inputLocked\}/);
  assert.match(source, /setSelectionRange\(nextCursor, nextCursor\)/);
});
