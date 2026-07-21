/**
 * Whether a finished message may show post-completion extras (related links,
 * file-change cards). Intentionally ignores session-wide "live"/streaming state:
 * gating on that unmounts EmbedBanner on every later turn and makes related
 * links vanish from already-finished messages until the new turn ends.
 * EmbedBanner already defers network work until idle.
 */
export function isPostCompletionExtrasReady({ messageComplete } = {}) {
  return Boolean(messageComplete);
}
