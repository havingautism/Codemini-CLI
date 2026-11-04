const ATTENTION = new Set(['failed', 'needs_attention', 'interrupted']);
// The Research library palette, bound to task IDs so sorting never changes a card's color.
const TONES = ['#5B8DEF', '#3D9B8F', '#C27A4A', '#8B6BC9', '#4A9B6E', '#B85C7A'];

export function latestScheduledRuns(runs = []) {
  const latest = new Map();
  for (const run of runs) {
    const previous = latest.get(run.taskId);
    if (!previous || Date.parse(run.createdAt) > Date.parse(previous.createdAt)) latest.set(run.taskId, run);
  }
  return latest;
}

export function scheduledTaskState(task, latestRun) {
  if (latestRun && (['queued', 'running'].includes(latestRun.status) || ATTENTION.has(latestRun.status))) return latestRun.status;
  if (!task.enabled && task.schedule.type === 'once' && ['completed', 'continued'].includes(latestRun?.status)) return latestRun.status;
  return task.enabled ? 'enabled' : 'paused';
}

export function scheduledTaskNeedsReschedule(task, now = Date.now()) {
  return !task.enabled && task.schedule.type === 'once' && Date.parse(task.schedule.at) <= now;
}

export function visibleScheduledTasks(tasks, runs, { query = '', filter = 'all', sort = 'next' } = {}) {
  const latest = latestScheduledRuns(runs);
  const needle = query.trim().toLocaleLowerCase();
  return tasks.filter(task => {
    if (filter === 'enabled' && !task.enabled) return false;
    if (filter === 'paused' && (task.enabled || ['completed', 'continued'].includes(scheduledTaskState(task, latest.get(task.id))))) return false;
    if (filter === 'attention' && !ATTENTION.has(latest.get(task.id)?.status)) return false;
    return !needle || [task.name, task.prompt, task.projectDir].join('\n').toLocaleLowerCase().includes(needle);
  }).sort((left, right) => {
    if (sort === 'title') return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
    if (sort === 'recent') return Date.parse(right.updatedAt || right.createdAt) - Date.parse(left.updatedAt || left.createdAt) || left.id.localeCompare(right.id);
    const a = left.enabled && left.nextRunAt ? Date.parse(left.nextRunAt) : Infinity;
    const b = right.enabled && right.nextRunAt ? Date.parse(right.nextRunAt) : Infinity;
    return (a === b ? 0 : a - b) || left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  });
}

export function visibleScheduledRuns(runs, query = '') {
  const needle = query.trim().toLocaleLowerCase();
  return runs.filter(run => !needle || [run.task.name, run.task.prompt, run.task.projectDir, run.error].join('\n').toLocaleLowerCase().includes(needle));
}

export function scheduledTaskTone(id = '') {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  return TONES[hash % TONES.length];
}

export function scheduledFrequencyLabel(schedule, translate, formatDate) {
  const parts = [translate(`scheduledFrequency_${schedule.type}`)];
  if (schedule.type === 'once') parts.push(formatDate(schedule.at));
  if (schedule.type === 'interval') parts.push(`${schedule.minutes} ${translate('scheduledMinuteUnit')}`);
  if (schedule.time) parts.push(schedule.time);
  if (schedule.days) parts.push(schedule.days.map(day => translate(`scheduledDay${day}`)).join(' / '));
  return parts.join(' · ');
}

function localDateTime(instant) {
  const date = new Date(instant);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function createScheduledTaskForm(task, projectDir = '', now = Date.now()) {
  const at = localDateTime(task?.schedule.at || now + 3600000);
  return {
    name: task?.name || '', prompt: task?.prompt || '', projectDir: task?.projectDir || projectDir,
    approvalMode: task?.approvalMode || 'auto',
    mode: task?.mode || 'normal', type: task?.schedule.type || 'daily', at,
    minutes: String(task?.schedule.minutes || 60), time: task?.schedule.time || '09:00',
    timeZone: task?.schedule.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    days: [...(task?.schedule.days || [1, 2, 3, 4, 5])],
  };
}

export function scheduledTaskFormPayload(form, task) {
  // Editing the prompt must not round seconds away or change the occurrence of
  // an ambiguous DST hour when the date/time field itself was left untouched.
  const originalInstant = task?.schedule.type === 'once' && form.at === localDateTime(task.schedule.at) ? task.schedule.at : '';
  const schedule = form.type === 'once' ? { type: 'once', at: originalInstant || new Date(form.at).toISOString() }
    : form.type === 'interval' ? { type: 'interval', minutes: Number(form.minutes) }
    : { type: form.type, time: form.time, timeZone: form.timeZone, ...(form.type === 'weekly' ? { days: [...form.days].sort((a, b) => a - b) } : {}) };
  return { ...(task && form.prompt.trim() === task.prompt ? { name: task.name } : {}), prompt: form.prompt.trim(), projectDir: form.projectDir.trim(), mode: form.mode, approvalMode: form.approvalMode || 'auto', schedule, enabled: task?.enabled ?? true };
}

export function scheduledAttentionKey(error = '') {
  return /tool approval/i.test(error) ? 'scheduledApprovalNeeded'
    : /your input/i.test(error) ? 'scheduledInputNeeded'
      : /draft|checkpoint/i.test(error) ? 'scheduledReviewNeeded' : 'scheduledAttentionHint';
}
