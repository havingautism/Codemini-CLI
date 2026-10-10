const DAY = 86400000;

// UTC arithmetic on date-only keys avoids DST gaps in the local calendar.
export function buildActivityGrid(activity, weekly = false) {
  if (!activity?.start || !activity?.end) return { weeks: [], months: [], total: 0 };
  const start = new Date(`${activity.start}T00:00:00Z`);
  const end = new Date(`${activity.end}T00:00:00Z`);
  const first = new Date(start.getTime() - start.getUTCDay() * DAY);
  const byDate = new Map(activity.days.map((day) => [day.date, day]));
  const weeks = [];
  const months = [];
  let lastMonth = '';
  for (let cursor = first.getTime(); cursor <= end.getTime(); cursor += DAY * 7) {
    const cells = Array.from({ length: 7 }, (_, index) => {
      const time = cursor + index * DAY;
      const date = new Date(time).toISOString().slice(0, 10);
      return { date, totalTokens: 0, requests: 0, unreportedRequests: 0, ...byDate.get(date), outside: time < start.getTime() || time > end.getTime() };
    });
    const inRange = cells.filter((cell) => !cell.outside);
    const month = inRange.find((cell) => cell.date.endsWith('-01'))?.date.slice(0, 7) || inRange[0]?.date.slice(0, 7);
    if (month && month !== lastMonth) {
      months.push({ column: weeks.length, month: Number(month.slice(5)) });
      lastMonth = month;
    }
    const totalTokens = inRange.reduce((sum, cell) => sum + cell.totalTokens, 0);
    weeks.push(weekly ? [{ date: inRange[0]?.date, end: inRange.at(-1)?.date, totalTokens,
      requests: inRange.reduce((sum, cell) => sum + cell.requests, 0),
      unreportedRequests: inRange.reduce((sum, cell) => sum + cell.unreportedRequests, 0) }] : cells);
  }
  const max = Math.max(0, ...weeks.flat().filter((cell) => !cell.outside).map((cell) => cell.totalTokens));
  for (const week of weeks) for (const cell of week) {
    cell.level = cell.totalTokens > 0 ? Math.min(4, Math.max(1, Math.ceil(cell.totalTokens / max * 4))) : 0;
  }
  return { weeks, months };
}
