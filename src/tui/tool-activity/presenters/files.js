import { makeBlocked, trimText } from '../common.js';

function describePathTool(copy, parsed, labels, { done = false, blocked = false } = {}) {
  const safeTarget = trimText(parsed.target, 72) || '.';
  if (blocked) return makeBlocked(copy, `${parsed.base}(${safeTarget})`);
  return done ? `${labels.done}: ${safeTarget}` : `${labels.doing}: ${safeTarget}`;
}

export function describeFileToolActivity(copy, parsed, options = {}) {
  if (parsed.base === 'read') {
    return describePathTool(copy, parsed, { done: copy.toolActivity.doneRead, doing: copy.toolActivity.doingRead }, options);
  }
  if (parsed.base === 'edit') {
    return describePathTool(copy, parsed, { done: copy.toolActivity.doneEdit, doing: copy.toolActivity.doingEdit }, options);
  }
  if (parsed.base === 'write') {
    return describePathTool(copy, parsed, { done: copy.toolActivity.doneWrite, doing: copy.toolActivity.doingWrite }, options);
  }
  if (parsed.base === 'list') {
    return describePathTool(copy, parsed, { done: copy.toolActivity.doneList, doing: copy.toolActivity.doingList }, options);
  }
  if (parsed.base === 'glob') {
    return describePathTool(
      copy,
      parsed,
      {
        done: copy.toolActivity.doneGlob || copy.toolActivity.doneList,
        doing: copy.toolActivity.doingGlob || copy.toolActivity.doingList
      },
      options
    );
  }
  if (parsed.base === 'grep') {
    return describePathTool(
      copy,
      parsed,
      {
        done: copy.toolActivity.doneGrep || copy.toolActivity.doneList,
        doing: copy.toolActivity.doingGrep || copy.toolActivity.doingList
      },
      options
    );
  }
  return '';
}
