import test from 'node:test';
import assert from 'node:assert/strict';

import { getFileToolMeta, getTodoToolItems } from '../codemini-web/client/src/lib/tool-card-display.js';

test('todo tool items accept streamed arguments and structured results', () => {
  const fromArgs = getTodoToolItems(JSON.stringify({
    todos: [
      { content: 'Inspect', activeForm: 'Inspecting', status: 'in_progress' },
      { content: 'Build', activeForm: 'Building', status: 'pending' },
    ],
  }));
  assert.deepEqual(fromArgs, [
    { content: 'Inspect', status: 'in_progress' },
    { content: 'Build', status: 'pending' },
  ]);

  assert.deepEqual(getTodoToolItems({}, { newTodos: [
    { content: 'Verify', activeForm: 'Verifying', status: 'completed' },
  ] }), [{ content: 'Verify', status: 'completed' }]);
});

test('delete tool preview keeps only the patch for its displayed file', () => {
  const firstPatch = [
    'diff --git a/keep.txt b/keep.txt',
    '--- a/keep.txt',
    '+++ b/keep.txt',
    '@@ -1 +1 @@',
    '-old',
    '+new',
  ].join('\n');
  const deletedPatch = [
    'diff --git a/delete.txt b/delete.txt',
    'deleted file mode 100644',
    '--- a/delete.txt',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-gone',
  ].join('\n');

  const meta = getFileToolMeta(
    'delete',
    { path: 'delete.txt' },
    {},
    '',
    null,
    null,
    [
      { path: 'keep.txt', diffPreview: firstPatch },
      { path: 'delete.txt', action: 'delete', diffPreview: deletedPatch },
    ],
  );

  assert.equal((meta.diffPreview.match(/^diff --git /gm) || []).length, 1);
  assert.equal(meta.path, 'delete.txt');
  assert.equal(meta.diffPreview, deletedPatch);
});
