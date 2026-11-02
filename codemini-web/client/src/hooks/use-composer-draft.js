import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { COMPOSER_DRAFT_FIELDS } from '../lib/composer-drafts.js';

export function useComposerDraft(store, sessionId) {
  const subscribe = useCallback(listener => store.subscribe(sessionId, listener), [store, sessionId]);
  const getSnapshot = useCallback(() => store.get(sessionId), [store, sessionId]);
  const draft = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  // Each setter keeps the originating session, including after an await or an
  // unmount. Functional updates read that session's latest draft.
  const setters = useMemo(() => Object.fromEntries(COMPOSER_DRAFT_FIELDS.map(field => [
    `set${field[0].toUpperCase()}${field.slice(1)}`,
    updater => store.update(sessionId, current => {
      const value = typeof updater === 'function' ? updater(current[field]) : updater;
      return Object.is(value, current[field]) ? current : { ...current, [field]: value };
    }),
  ])), [store, sessionId]);
  return { draft, ...setters };
}
