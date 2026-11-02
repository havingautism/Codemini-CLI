const DAY = 86400000;

// UTC arithmetic on date-only keys avoids DST gaps in the local calendar.
export function buildActivityGrid(activity, weekly = false) {
  if (!activity?.start || !activity?.end) return { weeks: [], months: [], total: 0 };
  const start = new Date(`${activity.start}T00:00:00Z`);
  const end = new Date(`${activity.end}T00:00:00Z`);
  const first = new Date(start.getTime() - ((start.getUTCDay() + 6) % 7) * DAY);
  const byDate = new Map(activity.days.map((day) => [day.date, day]));
  const weeks = [];
  const months = [];
  let lastMonth = '';
  for (let cursor = first.getTime(); cursor <= end.getTime(); cursor += DAY * 7) {
    const cells = Array.from({ length: 7 }, (_, index) => {
      const time = cursor + index * DAY;
      const date = new Date(time).toISOString().slice(0, 10);
      return { date, totalTokens: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0,
        requests: 0, unreportedRequests: 0, ...byDate.get(date), outside: time < start.getTime() || time > end.getTime() };
    });
    const inRange = cells.filter((cell) => !cell.outside);
    const month = inRange.find((cell) => cell.date.endsWith('-01'))?.date.slice(0, 7) || inRange[0]?.date.slice(0, 7);
    if (month && month !== lastMonth) {
      months.push({ column: weeks.length, month: Number(month.slice(5)) });
      lastMonth = month;
    }
    const totalOf = (key) => inRange.reduce((sum, cell) => sum + (Number(cell[key]) || 0), 0);
    const totalTokens = totalOf('totalTokens');
    weeks.push(weekly ? [{ date: inRange[0]?.date, end: inRange.at(-1)?.date, totalTokens,
      inputTokens: totalOf('inputTokens'), outputTokens: totalOf('outputTokens'),
      cachedInputTokens: totalOf('cachedInputTokens'), cacheWriteInputTokens: totalOf('cacheWriteInputTokens'),
      requests: totalOf('requests'), unreportedRequests: totalOf('unreportedRequests') }] : cells);
  }
  const max = Math.max(0, ...weeks.flat().filter((cell) => !cell.outside).map((cell) => cell.totalTokens));
  for (const week of weeks) for (const cell of week) {
    cell.level = cell.totalTokens > 0 ? Math.min(4, Math.max(1, Math.ceil(cell.totalTokens / max * 4))) : 0;
  }
  return { weeks, months };
}
