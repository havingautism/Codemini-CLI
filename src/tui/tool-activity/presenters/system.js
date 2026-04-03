import { makeBlocked, trimText } from '../common.js';

export function describeSystemToolActivity(copy, parsed, { done = false, blocked = false } = {}) {
  if (parsed.base === 'project_index') {
    if (blocked) return `${copy.toolActivity.blocked}: project index`;
    return done ? copy.toolActivity.doneProjectIndex : copy.toolActivity.doingProjectIndex;
  }
  if (parsed.base === 'file_index') {
    const safeTarget = trimText(parsed.target || '.codemini-project/file-index.json', 72);
    if (blocked) return makeBlocked(copy, safeTarget);
    return done ? `${copy.toolActivity.doneFileIndex}: ${safeTarget}` : `${copy.toolActivity.doingFileIndex}: ${safeTarget}`;
  }
  return '';
}
