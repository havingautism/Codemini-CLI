import { makeBlocked } from '../common.js';
import { formatToolLabel } from '../../../core/tool-display.js';

export function isCodeGenerationActivityName(name) {
  return String(name || '').trim() === 'Code generation';
}

export function describeMiscToolActivity(copy, parsed, rawName, { done = false, blocked = false } = {}) {
  if (isCodeGenerationActivityName(rawName)) {
    if (blocked) return `${copy.toolActivity.blocked}: code generation`;
    return done ? copy.toolActivity.doneCodeGeneration : copy.toolActivity.doingCodeGeneration;
  }
  if (parsed.base === 'tasks' || parsed.base === 'update_todos') {
    return blocked ? makeBlocked(copy, formatToolLabel('tasks')) : done ? copy.toolActivity.doneUpdateTodos : copy.toolActivity.doingUpdateTodos;
  }
  if (parsed.base === 'create_plan') {
    const label = formatToolLabel('create_plan');
    return blocked ? makeBlocked(copy, label) : done ? `${copy.toolActivity.doneGeneric}: ${label}` : `${copy.toolActivity.doingGeneric}: ${label}`;
  }
  if (parsed.base === 'create_spec') {
    const label = formatToolLabel('create_spec');
    return blocked ? makeBlocked(copy, label) : done ? `${copy.toolActivity.doneGeneric}: ${label}` : `${copy.toolActivity.doingGeneric}: ${label}`;
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
  const label = formatToolLabel(parsed.base || parsed.raw);
  return blocked ? `${copy.toolActivity.blocked}: ${label}` : done ? `${copy.toolActivity.doneGeneric}: ${label}` : `${copy.toolActivity.doingGeneric}: ${label}`;
}
