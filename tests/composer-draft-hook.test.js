import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createComposerDraftStore } from '../codemini-web/client/src/lib/composer-drafts.js';
import { useComposerDraft } from '../codemini-web/client/src/hooks/use-composer-draft.js';

const requireWeb = createRequire(new URL('../codemini-web/package.json', import.meta.url));
const { createElement } = requireWeb('react');
const { renderToString } = requireWeb('react-dom/server');

function renderDraft(store, sessionId) {
  let binding;
  function ComposerProbe() {
    binding = useComposerDraft(store, sessionId);
    return createElement('textarea', { value: binding.draft.value, readOnly: true });
  }
  const html = renderToString(createElement(ComposerProbe));
  return { ...binding, html };
}

test('React draft bindings render the selected session and retain the origin in stale callbacks', async () => {
  const store = createComposerDraftStore();
  const a = renderDraft(store, 'a');
  a.setValue('A draft');
  a.setAttachments([{ id: 'a-1' }]);
  const b = renderDraft(store, 'b');
  assert.equal(b.draft.value, '');
  assert.deepEqual(b.draft.attachments, []);
  b.setValue('B draft');
  // Simulate a result arriving from a component that has already unmounted.
  await Promise.resolve();
  a.setAttachments(previous => [...previous, { id: 'a-2' }]);
  assert.match(renderDraft(store, 'b').html, /B draft/);
  assert.deepEqual(renderDraft(store, 'b').draft.attachments, []);
  const restored = renderDraft(store, 'a');
  assert.match(restored.html, /A draft/);
  assert.deepEqual(restored.draft.attachments, [{ id: 'a-1' }, { id: 'a-2' }]);
});

test('returning to an uploading session renders its latest loading and failure state', async () => {
  const store = createComposerDraftStore();
  const result = Promise.withResolvers();
  const pending = store.upload('a', () => result.promise, 'Upload failed');
  assert.equal(renderDraft(store, 'a').draft.uploadingAttachments, true);
  assert.equal(renderDraft(store, 'b').draft.uploadingAttachments, false);
  result.resolve({ error: true, message: 'Retry this attachment' });
  await pending;
  const restored = renderDraft(store, 'a');
  assert.equal(restored.draft.uploadingAttachments, false);
  assert.equal(restored.draft.attachmentError, 'Retry this attachment');
  assert.equal(renderDraft(store, 'b').draft.attachmentError, '');
});
