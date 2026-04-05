import { classifyRunIntent, makeBlocked, trimText } from '../common.js';

function phaseText(copy, blocked, done, target, doingLabel, doneLabel) {
  if (blocked) return makeBlocked(copy, target);
  return done ? `${doneLabel}: ${target}` : `${doingLabel}: ${target}`;
}

export function describeCommandToolActivity(copy, parsed, { done = false, blocked = false } = {}) {
  const target = parsed.target || 'command';
  const intent = classifyRunIntent(parsed.target);

  if (parsed.base === 'run') {
    if (intent.kind === 'install') return phaseText(copy, blocked, done, target, copy.toolActivity.doingInstall, copy.toolActivity.doneInstall);
    if (intent.kind === 'build') return phaseText(copy, blocked, done, target, copy.toolActivity.doingBuild, copy.toolActivity.doneBuild);
    if (intent.kind === 'test') return phaseText(copy, blocked, done, target, copy.toolActivity.doingTest, copy.toolActivity.doneTest);
    if (intent.kind === 'frontend-service') return phaseText(copy, blocked, done, target, copy.toolActivity.doingFrontend, copy.toolActivity.doneFrontend);
    if (intent.kind === 'backend-service') return phaseText(copy, blocked, done, target, copy.toolActivity.doingBackend, copy.toolActivity.doneBackend);
    if (intent.kind === 'database-service') return phaseText(copy, blocked, done, target, copy.toolActivity.doingDatabase, copy.toolActivity.doneDatabase);
    if (intent.kind === 'docker-service') return phaseText(copy, blocked, done, target, copy.toolActivity.doingDocker, copy.toolActivity.doneDocker);
    if (intent.kind === 'service') return phaseText(copy, blocked, done, target, copy.toolActivity.doingGeneric, copy.toolActivity.doneGeneric);
    return phaseText(copy, blocked, done, trimText(target, 72) || parsed.base, copy.toolActivity.doingCommand, copy.toolActivity.doneCommand);
  }

  if (parsed.base === 'list_background_tasks') {
    return phaseText(copy, blocked, done, trimText(parsed.target, 72) || parsed.base, copy.toolActivity.doingListBackgroundTasks, copy.toolActivity.doneListBackgroundTasks);
  }
  if (parsed.base === 'get_background_task') {
    return phaseText(copy, blocked, done, trimText(parsed.target, 72) || parsed.base, copy.toolActivity.doingBackgroundTaskStatus, copy.toolActivity.doneBackgroundTaskStatus);
  }
  if (parsed.base === 'stop_background_task') {
    return phaseText(copy, blocked, done, trimText(parsed.target, 72) || parsed.base, copy.toolActivity.doingStopBackgroundTask, copy.toolActivity.doneStopBackgroundTask);
  }

  return '';
}
