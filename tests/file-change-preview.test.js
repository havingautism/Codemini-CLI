import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveFileChangePreviewLines,
  unifiedPatchToPreviewLines,
} from '../codemini-web/client/src/lib/file-change-preview.js';

test('unifiedPatchToPreviewLines keeps context around comment-only additions', () => {
  const patch = [
    'diff --git a/lib/widgets/markdown_renderer.dart b/lib/widgets/markdown_renderer.dart',
    'index 111..222 100644',
    '--- a/lib/widgets/markdown_renderer.dart',
    '+++ b/lib/widgets/markdown_renderer.dart',
    '@@ -10,6 +10,7 @@ class MarkdownRenderer {',
    '   Widget build(BuildContext context) {',
    '+    // test comment',
    '     return const SizedBox();',
    '   }',
    ' }',
  ].join('\n');

  const lines = unifiedPatchToPreviewLines(patch);
  assert.equal(lines.length, 5);
  assert.deepEqual(lines[0], {
    type: 'context',
    marker: ' ',
    number: '10',
    oldNumber: '10',
    newNumber: '10',
    text: '  Widget build(BuildContext context) {',
  });
  assert.deepEqual(lines[1], {
    type: 'add',
    marker: '+',
    number: '11',
    oldNumber: '',
    newNumber: '11',
    text: '    // test comment',
  });
  assert.equal(lines[2].type, 'context');
  assert.equal(lines[2].text, '    return const SizedBox();');
  assert.equal(lines[3].type, 'context');
  assert.equal(lines[4].type, 'context');
});

test('resolveFileChangePreviewLines supports tool +N| format and unified patches', () => {
  assert.deepEqual(resolveFileChangePreviewLines('+12| // note'), [
    {
      type: 'add',
      marker: '+',
      number: '12',
      oldNumber: '',
      newNumber: '12',
      text: '// note',
    },
  ]);

  const unified = [
    'diff --git a/a.dart b/a.dart',
    '--- a/a.dart',
    '+++ b/a.dart',
    '@@ -1,2 +1,3 @@',
    ' line',
    '+// comment',
    ' end',
  ].join('\n');
  const lines = resolveFileChangePreviewLines(unified);
  assert.equal(lines.length, 3);
  assert.equal(lines[0].type, 'context');
  assert.equal(lines[1].type, 'add');
  assert.equal(lines[1].text, '// comment');
  assert.equal(lines[2].type, 'context');
});

test('unified replace shows both remove and add with surrounding context', () => {
  const patch = [
    'diff --git a/a.js b/a.js',
    '--- a/a.js',
    '+++ b/a.js',
    '@@ -1,3 +1,3 @@',
    ' keep',
    '-old',
    '+new',
    ' tail',
  ].join('\n');
  const lines = unifiedPatchToPreviewLines(patch);
  assert.deepEqual(
    lines.map((line) => [line.type, line.text]),
    [
      ['context', 'keep'],
      ['remove', 'old'],
      ['add', 'new'],
      ['context', 'tail'],
    ],
  );
});

test('unified parser keeps source lines that resemble file headers', () => {
  const patch = [
    'diff --git a/a.js b/a.js',
    '--- a/a.js',
    '+++ b/a.js',
    '@@ -4,2 +4,2 @@',
    ' keep',
    '--- old divider',
    '+++ new divider',
  ].join('\n');

  const lines = unifiedPatchToPreviewLines(patch);
  assert.deepEqual(
    lines.map((line) => [
      line.type,
      line.oldNumber,
      line.newNumber,
      line.marker,
      line.text,
    ]),
    [
      ['context', '4', '4', ' ', 'keep'],
      ['remove', '5', '', '-', '-- old divider'],
      ['add', '', '5', '+', '++ new divider'],
    ],
  );
});

test('hunk-only patches are recognized and use old/new line columns', () => {
  const lines = resolveFileChangePreviewLines(
    ['@@ -7,2 +7,2 @@', '-before', '+after', ' context'].join('\n'),
  );

  assert.deepEqual(
    lines.map((line) => [line.oldNumber, line.newNumber, line.marker]),
    [
      ['7', '', '-'],
      ['', '7', '+'],
      ['8', '8', ' '],
    ],
  );
});
