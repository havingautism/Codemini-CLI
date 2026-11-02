const MINUTE = 60_000;

export function normalizeTaskSchedule(input = {}) {
  const type = input.type;
  if (type === 'once') {
    if (typeof input.at !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(input.at) || !Number.isFinite(Date.parse(input.at))) {
      throw new Error('A one-time schedule requires a valid date with a timezone.');
    }
    return { type, at: new Date(input.at).toISOString() };
  }
  if (type === 'interval') {
    if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 525600) throw new Error('Interval must be 1–525600 whole minutes.');
    return { type, minutes: input.minutes };
  }
  if (!['daily', 'weekly'].includes(type) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time || '')) throw new Error('Choose a valid schedule and time.');
  const timeZone = String(input.timeZone || '').trim();
  if (!timeZone) throw new Error('Timezone is required.');
  new Intl.DateTimeFormat('en', { timeZone }).format();
  const result = { type, time: input.time, timeZone };
  if (type === 'weekly') {
    if (!Array.isArray(input.days) || !input.days.length || input.days.some(day => !Number.isInteger(day) || day < 1 || day > 7)) throw new Error('Choose at least one weekday (Monday=1, Sunday=7).');
    result.days = [...new Set(input.days)].sort((a, b) => a - b);
  }
  return result;
}

function calendarFormatter(timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, calendar: 'iso8601', numberingSystem: 'latn',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

function calendarParts(formatter, instant) {
  const parts = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`,
    day: new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day))).getUTCDay() || 7 };
}

// Skip missed repetitions instead of launching a backlog. For DST folds, a
// claimed wall-clock date is excluded so a daily/weekly task runs once per day.
export function nextTaskTime(schedule, after = Date.now(), previousDue = '') {
  const now = Number(after);
  if (schedule.type === 'once') return schedule.at;
  if (schedule.type === 'interval') return new Date(now + schedule.minutes * MINUTE).toISOString();
  const formatter = calendarFormatter(schedule.timeZone);
  const excluded = previousDue ? calendarParts(formatter, new Date(previousDue)).date : '';
  for (let instant = Math.floor(now / MINUTE) * MINUTE + MINUTE, end = now + 9 * 24 * 60 * MINUTE; instant < end; instant += MINUTE) {
    const parts = calendarParts(formatter, instant);
    if (parts.date !== excluded && parts.time === schedule.time && (schedule.type === 'daily' || schedule.days.includes(parts.day))) return new Date(instant).toISOString();
  }
  throw new Error('No next occurrence found.');
}
