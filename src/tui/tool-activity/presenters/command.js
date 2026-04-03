import { classifyRunIntent, makeBlocked, trimText } from '../common.js';

function phaseText(copy, blocked, done, target, doingLabel, doneLabel) {
  if (blocked) return makeBlocked(copy, target);
  return done ? `${doneLabel}: ${target}` : `${doingLabel}: ${target}`;
}

export function describeCommandToolActivity(copy, parsed, { done = false, blocked = false } = {}) {
  const target = parsed.target || 'command';
  const intent = classifyRunIntent(parsed.target);

  if (parsed.base === 'run' || parsed.base === 'start_service') {
    if (intent.kind === 'install') return phaseText(copy, blocked, done, target, copy.toolActivity.doingInstall, copy.toolActivity.doneInstall);
    if (intent.kind === 'build') return phaseText(copy, blocked, done, target, copy.toolActivity.doingBuild, copy.toolActivity.doneBuild);
    if (intent.kind === 'test') return phaseText(copy, blocked, done, target, copy.toolActivity.doingTest, copy.toolActivity.doneTest);
    if (intent.kind === 'frontend-service') return phaseText(copy, blocked, done, target, copy.toolActivity.doingFrontend, copy.toolActivity.doneFrontend);
    if (intent.kind === 'backend-service') return phaseText(copy, blocked, done, target, copy.toolActivity.doingBackend, copy.toolActivity.doneBackend);
    if (intent.kind === 'database-service') return phaseText(copy, blocked, done, target, copy.toolActivity.doingDatabase, copy.toolActivity.doneDatabase);
    if (intent.kind === 'docker-service') return phaseText(copy, blocked, done, target, copy.toolActivity.doingDocker, copy.toolActivity.doneDocker);
    if (intent.kind === 'service') return phaseText(copy, blocked, done, target, copy.toolActivity.doingGeneric, copy.toolActivity.doneGeneric);
    if (parsed.base === 'run') return phaseText(copy, blocked, done, trimText(target, 72) || parsed.base, copy.toolActivity.doingCommand, copy.toolActivity.doneCommand);
  }

  if (parsed.base === 'list_services') {
    return phaseText(copy, blocked, done, trimText(parsed.target, 72) || parsed.base, copy.toolActivity.doingListServices, copy.toolActivity.doneListServices);
  }
  if (parsed.base === 'get_service_status') {
    return phaseText(copy, blocked, done, trimText(parsed.target, 72) || parsed.base, copy.toolActivity.doingServiceStatus, copy.toolActivity.doneServiceStatus);
  }
  if (parsed.base === 'get_service_logs') {
    return phaseText(copy, blocked, done, trimText(parsed.target, 72) || parsed.base, copy.toolActivity.doingServiceLogs, copy.toolActivity.doneServiceLogs);
  }
  if (parsed.base === 'stop_service') {
    return phaseText(copy, blocked, done, trimText(parsed.target, 72) || parsed.base, copy.toolActivity.doingStopService, copy.toolActivity.doneStopService);
  }

  if (parsed.base === 'start_service') {
    return phaseText(copy, blocked, done, trimText(parsed.target, 72) || parsed.base, copy.toolActivity.doingGeneric, copy.toolActivity.doneGeneric);
  }

  return '';
}
