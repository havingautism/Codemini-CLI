import { getLastToolActivity, parseToolDisplayName, renderLocalizedEntry, trimText } from './tool-narration/common.js';
import { inferChangeKind } from './tool-narration/presenters/change.js';
import { editPresenter } from './tool-narration/presenters/edit.js';
import { genericPresenter } from './tool-narration/presenters/generic.js';
import { globPresenter } from './tool-narration/presenters/glob.js';
import { grepPresenter } from './tool-narration/presenters/grep.js';
import { listPresenter } from './tool-narration/presenters/list.js';
import { patchPresenter } from './tool-narration/presenters/patch.js';
import { readPresenter } from './tool-narration/presenters/read.js';
import { runPresenter } from './tool-narration/presenters/run.js';
import { writePresenter } from './tool-narration/presenters/write.js';

const BASE_PRESENTERS = {
  read: readPresenter,
  list: listPresenter,
  glob: globPresenter,
  grep: grepPresenter,
  write: writePresenter,
  edit: editPresenter,
  patch: patchPresenter,
  generate_diff: patchPresenter,
  run: runPresenter
};

function resolveNarrationContext(name) {
  const { base, target } = parseToolDisplayName(name);
  const presenter = BASE_PRESENTERS[base] || genericPresenter;
  const changeKind = inferChangeKind(target);
  return {
    base,
    target: trimText(target, 48),
    presenter,
    bridgeGroup: presenter?.meta?.bridgeGroup || 'generic',
    verb: presenter?.meta?.verb || 'update',
    verbZh: presenter?.meta?.verbZh || '修改',
    changeKind
  };
}

export function buildPreToolNotice(name, copy) {
  const context = resolveNarrationContext(name);
  return renderLocalizedEntry(context.presenter.prelude, copy, context);
}

export function buildInterToolNotice(previousActivity, nextToolName, copy) {
  const previousContext = resolveNarrationContext(previousActivity?.name);
  const nextContext = resolveNarrationContext(nextToolName);
  const bridge = nextContext.presenter?.bridges?.[previousContext.bridgeGroup];
  return renderLocalizedEntry(bridge, copy, {
    ...nextContext,
    nextTarget: nextContext.target,
    hasContext: previousContext.bridgeGroup !== 'generic'
  });
}

export function buildSyntheticCompletionText(msg, copy) {
  const activity = getLastToolActivity(msg, ['done', 'running']);
  if (!activity) {
    return renderLocalizedEntry(genericPresenter.completion, copy, {});
  }

  const context = resolveNarrationContext(activity.name);
  return renderLocalizedEntry(context.presenter.completion, copy, {
    ...context,
    target: trimText(context.target, 56)
  });
}
