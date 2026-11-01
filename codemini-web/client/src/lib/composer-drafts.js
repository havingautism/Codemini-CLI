import { createComposerState } from './chat-composer-state.js';

export const COMPOSER_DRAFT_FIELDS = [
  'value', 'attachments', 'referencedFiles', 'selectedSkills', 'scrapbookContext',
  'dismissedDefaultSkills', 'actionParameter', 'attachmentError', 'uploadingAttachments',
];

function emptyDraft() {
  return {
    value: '', attachments: [], referencedFiles: [], selectedSkills: [], scrapbookContext: null,
    dismissedDefaultSkills: new Set(), actionParameter: createComposerState(),
    attachmentError: '', uploadingAttachments: false,
  };
}

// Owned by one Web app instance. Drafts survive composer unmounts and session
// switches, but are not written to browser storage or the user's transcript.
export function createComposerDraftStore() {
  const drafts = new Map();
  const listeners = new Map();
  const blank = emptyDraft();
  const get = sessionId => drafts.get(sessionId) || blank;
  const update = (sessionId, updater) => {
    if (!sessionId) return;
    const current = get(sessionId);
    const next = updater(current);
    if (next === current) return;
    drafts.set(sessionId, next);
    for (const listener of listeners.get(sessionId) || []) listener();
  };
  return {
    get,
    update,
    subscribe(sessionId, listener) {
      if (!listeners.has(sessionId)) listeners.set(sessionId, new Set());
      listeners.get(sessionId).add(listener);
      return () => {
        const group = listeners.get(sessionId);
        group?.delete(listener);
        if (!group?.size) listeners.delete(sessionId);
      };
    },
    clearSubmitted(sessionId, submitted) {
      update(sessionId, current => {
        const cleared = emptyDraft();
        const next = { ...current };
        // A turn can finish after the user switches away or edits a new draft.
        // Clear only fields that still belong to the submitted snapshot.
        for (const field of ['value', 'attachments', 'referencedFiles', 'selectedSkills',
          'scrapbookContext', 'dismissedDefaultSkills', 'attachmentError']) {
          if (current[field] === submitted[field]) next[field] = cleared[field];
        }
        return next;
      });
    },
    async upload(sessionId, runUpload, fallbackError) {
      if (!sessionId || get(sessionId).uploadingAttachments) return false;
      update(sessionId, current => ({ ...current, uploadingAttachments: true, attachmentError: '' }));
      try {
        const result = await runUpload();
        if (result?.error) throw new Error(result.message || fallbackError);
        update(sessionId, current => ({
          ...current,
          attachments: [...current.attachments, ...(Array.isArray(result?.attachments) ? result.attachments : [])].slice(0, 8),
        }));
      } catch (error) {
        update(sessionId, current => ({ ...current, attachmentError: error?.message || fallbackError }));
      } finally {
        update(sessionId, current => ({ ...current, uploadingAttachments: false }));
      }
      return true;
    },
  };
}
