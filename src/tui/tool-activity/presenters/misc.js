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
  return blocked ? `${copy.toolActivity.blocked}: ${parsed.raw}` : done ? `${copy.toolActivity.doneGeneric}: ${parsed.raw}` : `${copy.toolActivity.doingGeneric}: ${parsed.raw}`;
}
