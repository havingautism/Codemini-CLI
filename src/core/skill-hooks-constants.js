export const HOOK_EVENTS = new Set([
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
]);

/** Lower number = higher priority */
export const HOOK_SOURCE_PRIORITY = {
  // hooks/hooks.json is the editable local override. Frontmatter remains the
  // portable package default, but must not make Web UI edits ineffective.
  'skill-json': 1,
  frontmatter: 2,
  package: 3,
  settings: 4,
};

export function hookEventI18nKey(eventName) {
  return `hookEvent_${eventName}`;
}
