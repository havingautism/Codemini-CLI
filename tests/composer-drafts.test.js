import test from 'node:test';
import assert from 'node:assert/strict';
import { createComposerDraftStore } from '../codemini-web/client/src/lib/composer-drafts.js';

const deferred = () => Promise.withResolvers();
const edit = (store, id, fields) => store.update(id, draft => ({ ...draft, ...fields }));

test('switching sessions restores each complete draft, including images, files and skill choices', () => {
  const store = createComposerDraftStore();
  const fields = {
    value: 'A 的未发送消息', attachments: [{ id: 'image-a', kind: 'image' }],
    referencedFiles: [{ path: 'src/a.js' }], selectedSkills: [{ name: 'review' }],
    scrapbookContext: { entryId: 'note-a', modelText: 'context' },
    dismissedDefaultSkills: new Set(['always-a']),
    actionParameter: { activeAction: 'capture', parameterText: 'draft parameter' },
  };
  edit(store, 'a', fields);
  assert.equal(store.get('b').value, '');
  assert.deepEqual(store.get('b').attachments, []);
  edit(store, 'b', { value: 'B 的消息', attachments: [{ id: 'doc-b' }] });
  for (const [key, value] of Object.entries(fields)) assert.deepEqual(store.get('a')[key], value, key);
  assert.equal(store.get('b').value, 'B 的消息');
});

test('an upload finishing while another session is visible only updates its origin', async () => {
  const store = createComposerDraftStore();
  const uploaded = deferred();
  edit(store, 'a', { value: 'look at this' });
  const pending = store.upload('a', () => uploaded.promise, 'Upload failed');
  assert.equal(store.get('a').uploadingAttachments, true);
  assert.equal(store.get('b').uploadingAttachments, false);
  edit(store, 'b', { value: 'keep this B draft' });
  const untouched = store.get('b');
  // The composer for A may be unmounted and then remounted before completion.
  const notifications = [];
  const unsubscribe = store.subscribe('a', () => notifications.push(store.get('a')));
  assert.equal(store.get('a').uploadingAttachments, true);
  uploaded.resolve({ attachments: [{ id: 'image-a' }] });
  await pending;
  assert.equal(store.get('b'), untouched);
  assert.equal(store.get('a').value, 'look at this');
  assert.deepEqual(store.get('a').attachments, [{ id: 'image-a' }]);
  assert.equal(store.get('a').uploadingAttachments, false);
  assert.ok(notifications.length > 0);
  unsubscribe();
});

test('late upload failures stay in the originating session and can be retried', async () => {
  const store = createComposerDraftStore();
  const uploaded = deferred();
  const pending = store.upload('a', () => uploaded.promise, 'Upload failed');
  edit(store, 'b', { value: 'B', attachmentError: 'B error' });
  uploaded.reject(new Error('Network interrupted'));
  await pending;
  assert.equal(store.get('a').attachmentError, 'Network interrupted');
  assert.equal(store.get('a').uploadingAttachments, false);
  assert.equal(store.get('b').attachmentError, 'B error');
  await store.upload('a', async () => ({ attachments: [{ id: 'retry-a' }] }), 'Upload failed');
  assert.equal(store.get('a').attachmentError, '');
  assert.deepEqual(store.get('a').attachments, [{ id: 'retry-a' }]);
});

test('duplicate upload actions are locked per session without blocking other sessions', async () => {
  const store = createComposerDraftStore();
  const uploaded = deferred();
  const pending = store.upload('a', () => uploaded.promise, 'Upload failed');
  let duplicateCalls = 0;
  assert.equal(await store.upload('a', async () => { duplicateCalls++; }, 'Upload failed'), false);
  assert.equal(duplicateCalls, 0);
  assert.equal(await store.upload('b', async () => ({ attachments: [{ id: 'b' }] }), 'Upload failed'), true);
  uploaded.resolve({ attachments: [{ id: 'a' }] });
  await pending;
  assert.deepEqual(store.get('a').attachments, [{ id: 'a' }]);
  assert.deepEqual(store.get('b').attachments, [{ id: 'b' }]);
});

test('late successful submission clears its own draft and preserves another session', () => {
  const store = createComposerDraftStore();
  edit(store, 'a', { value: 'sent A', attachments: [{ id: 'a' }], selectedSkills: [{ name: 'review' }] });
  const submitted = store.get('a');
  edit(store, 'b', { value: 'unsent B', attachments: [{ id: 'b' }] });
  const untouched = store.get('b');
  store.clearSubmitted('a', submitted);
  assert.equal(store.get('a').value, '');
  assert.deepEqual(store.get('a').attachments, []);
  assert.deepEqual(store.get('a').selectedSkills, []);
  assert.equal(store.get('b'), untouched);
});

test('a reply completing after editing a new draft preserves the new content', () => {
  const store = createComposerDraftStore();
  edit(store, 'a', { value: 'sent', attachments: [{ id: 'sent-image' }] });
  const submitted = store.get('a');
  edit(store, 'a', { value: 'new draft', selectedSkills: [{ name: 'new-skill' }] });
  store.clearSubmitted('a', submitted);
  assert.equal(store.get('a').value, 'new draft');
  assert.deepEqual(store.get('a').selectedSkills, [{ name: 'new-skill' }]);
  assert.deepEqual(store.get('a').attachments, []);
});

test('draft notifications do not leak across sessions or after unsubscribe', () => {
  const store = createComposerDraftStore();
  let calls = 0;
  const unsubscribe = store.subscribe('a', () => { calls++; });
  edit(store, 'b', { value: 'B' });
  assert.equal(calls, 0);
  edit(store, 'a', { value: 'A' });
  assert.equal(calls, 1);
  unsubscribe();
  edit(store, 'a', { value: 'A2' });
  assert.equal(calls, 1);
  assert.equal(store.get('b'), store.get('b'), 'external-store snapshots remain stable between updates');
});

test('no active session cannot start an upload or create a shared draft', async () => {
  const store = createComposerDraftStore();
  edit(store, '', { value: 'must not leak' });
  let uploaded = false;
  assert.equal(await store.upload('', async () => { uploaded = true; }, 'Upload failed'), false);
  assert.equal(uploaded, false);
  assert.equal(store.get('').value, '');
});
