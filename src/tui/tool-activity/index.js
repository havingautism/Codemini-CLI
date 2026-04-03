import { parseToolDisplayName } from './common.js';
import { describeCommandToolActivity } from './presenters/command.js';
import { describeFileToolActivity } from './presenters/files.js';
import { describeMiscToolActivity } from './presenters/misc.js';
import { describeSystemToolActivity } from './presenters/system.js';

export { isCodeGenerationActivityName } from './presenters/misc.js';

export function describeToolActivity(copy, name, options = {}) {
  const parsed = parseToolDisplayName(name);
  return (
    describeSystemToolActivity(copy, parsed, options) ||
    describeCommandToolActivity(copy, parsed, options) ||
    describeFileToolActivity(copy, parsed, options) ||
    describeMiscToolActivity(copy, parsed, name, options)
  );
}
