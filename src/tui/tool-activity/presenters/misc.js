import { makeBlocked } from '../common.js';

export function isCodeGenerationActivityName(name) {
  return String(name || '').trim() === 'Code generation';
}

export function describeMiscToolActivity(copy, parsed, rawName, { done = false, blocked = false } = {}) {
  if (isCodeGenerationActivityName(rawName)) {
    if (blocked) return `${copy.toolActivity.blocked}: code generation`;
    return done ? copy.toolActivity.doneCodeGeneration : copy.toolActivity.doingCodeGeneration;
  }
  if (parsed.base === 'create_task') {
    return blocked ? makeBlocked(copy, 'create_task') : done ? copy.toolActivity.doneCreateTask : copy.toolActivity.doingCreateTask;
  }
  if (parsed.base === 'update_task') {
    return blocked ? makeBlocked(copy, 'update_task') : done ? copy.toolActivity.doneUpdateTask : copy.toolActivity.doingUpdateTask;
  }
  return blocked ? `${copy.toolActivity.blocked}: ${parsed.raw}` : done ? `${copy.toolActivity.doneGeneric}: ${parsed.raw}` : `${copy.toolActivity.doingGeneric}: ${parsed.raw}`;
}
