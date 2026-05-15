import { makeBlocked, trimText } from '../common.js';

export function describeSystemToolActivity(copy, parsed, { done = false, blocked = false } = {}) {
  if (parsed.base === 'project_index') {
    if (blocked) return `${copy.toolActivity.blocked}: ${copy.toolActivity.doingProjectIndex}`;
    return done ? copy.toolActivity.doneProjectIndex : copy.toolActivity.doingProjectIndex;
  }
  if (parsed.base === 'file_index') {
    const safeTarget = trimText(parsed.target || '.codemini/file-index.json', 72);
    if (blocked) return makeBlocked(copy, safeTarget);
    return done ? `${copy.toolActivity.doneFileIndex}: ${safeTarget}` : `${copy.toolActivity.doingFileIndex}: ${safeTarget}`;
  }
  if (parsed.base === 'prompt_budget') {
    if (blocked) return makeBlocked(copy, 'prompt_budget');
    return done
      ? (copy.toolActivity.donePromptBudget || 'Prompt budget measured')
      : (copy.toolActivity.doingPromptBudget || 'Measuring prompt budget');
  }
  return '';
}
