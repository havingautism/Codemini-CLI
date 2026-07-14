/** Shared helpers for hook activity rows in the chat transcript. */

export const HOOK_EVENT_NAMES = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SessionEnd',
];

export function hookEventI18nKey(eventName = '') {
  return `hookEvent_${String(eventName || '').trim()}`;
}

/**
 * Build a stable skill-segment payload for hook:start / hook:end matching.
 * `name` is an opaque match key; UI should prefer structured fields for display.
 */
export function buildHookSegmentEvent(event = {}) {
  const hookEvent = String(event.event || event.hookEvent || '').trim();
  const sourceLabel = String(
    event.sourceLabel || event.name || event.skillName || 'hook',
  ).trim() || 'hook';
  const toolName = String(event.toolName || '').trim();
  const matcher = String(event.matcher || '').trim();
  const command = String(event.command || '').trim();
  const source = String(event.source || '').trim();
  const name = [hookEvent || 'hook', sourceLabel, toolName || matcher || ''].join('::');

  return {
    kind: 'hook',
    name,
    event: hookEvent,
    source,
    sourceLabel,
    toolName,
    matcher,
    command,
    summary: String(event.summary || '').trim(),
    reason: String(event.reason || '').trim(),
    startedAt: event.startedAt,
    endedAt: event.endedAt,
  };
}

export function isHookSegment(segment = {}) {
  if (segment?.kind === 'hook') return true;
  if (HOOK_EVENT_NAMES.includes(String(segment?.event || '').trim())) return true;
  const name = String(segment?.name || '');
  return (
    name.includes(' · ') ||
    /^(SessionStart|UserPromptSubmit|PreToolUse|PostToolUse|Stop|SessionEnd)\b/.test(name)
  );
}

/** Best-effort parse for transcripts saved before structured hook fields existed. */
export function parseLegacyHookSegmentName(name = '') {
  const text = String(name || '').trim();
  const match = text.match(
    /^(SessionStart|UserPromptSubmit|PreToolUse|PostToolUse|Stop|SessionEnd)(?:\s·\s(.+?))?\s←\s(.+)$/,
  );
  if (!match) return null;
  return {
    event: match[1],
    toolName: String(match[2] || '').trim(),
    sourceLabel: String(match[3] || '').trim(),
  };
}
