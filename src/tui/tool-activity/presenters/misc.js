import { makeBlocked } from '../common.js';

export function isCodeGenerationActivityName(name) {
  return String(name || '').trim() === 'Code generation';
}

export function describeMiscToolActivity(copy, parsed, rawName, { done = false, blocked = false } = {}) {
  if (isCodeGenerationActivityName(rawName)) {
    if (blocked) return `${copy.toolActivity.blocked}: code generation`;
    return done ? copy.toolActivity.doneCodeGeneration : copy.toolActivity.doingCodeGeneration;
  }
  if (parsed.base === 'update_todos') {
    return blocked ? makeBlocked(copy, 'update_todos') : done ? copy.toolActivity.doneUpdateTodos : copy.toolActivity.doingUpdateTodos;
  }
  if (parsed.base === 'web_fetch') {
    const target = parsed.target || parsed.raw;
    const label = done
      ? (copy.toolActivity.doneWebFetch || copy.toolActivity.doneGeneric)
      : (copy.toolActivity.doingWebFetch || copy.toolActivity.doingGeneric);
    return blocked ? makeBlocked(copy, target) : `${label}: ${target}`;
  }
  if (parsed.base === 'web_search') {
    const target = parsed.target || parsed.raw;
    const label = done
      ? (copy.toolActivity.doneWebSearch || copy.toolActivity.doneGeneric)
      : (copy.toolActivity.doingWebSearch || copy.toolActivity.doingGeneric);
    return blocked ? makeBlocked(copy, target) : `${label}: ${target}`;
  }
  return blocked ? `${copy.toolActivity.blocked}: ${parsed.raw}` : done ? `${copy.toolActivity.doneGeneric}: ${parsed.raw}` : `${copy.toolActivity.doingGeneric}: ${parsed.raw}`;
}
