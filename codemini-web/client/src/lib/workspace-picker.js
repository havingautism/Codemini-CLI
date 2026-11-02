export function projectOptions(paths, current = '') {
  const unique = new Map();
  for (const path of [current, ...paths]) {
    if (!path) continue;
    const key = /^[a-z]:[\\/]|^\\\\/i.test(path) ? path.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() : path.replace(/\/$/, '');
    if (!unique.has(key)) unique.set(key, { value: path, label: path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path, description: path });
  }
  return [...unique.values()];
}

export function timeZoneOptions(locale, current = '', local = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const common = ['Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Tokyo', 'Asia/Singapore', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'UTC'];
  const aliases = { 'Asia/Shanghai': '北京 上海 中国', 'Asia/Hong_Kong': '香港', 'Asia/Taipei': '台北 台湾', 'Asia/Tokyo': '东京 日本', 'Asia/Singapore': '新加坡', 'Europe/London': '伦敦 英国', 'Europe/Paris': '巴黎 法国', 'America/New_York': '纽约 美国 东部', 'America/Los_Angeles': '洛杉矶 美国 西部' };
  const zones = [...new Set([current, local, ...common, ...(Intl.supportedValuesOf?.('timeZone') || [])].filter(Boolean))];
  return zones.flatMap(zone => {
    try {
      const label = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'longGeneric' }).formatToParts(new Date()).find(part => part.type === 'timeZoneName')?.value;
      const offset = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(new Date()).find(part => part.type === 'timeZoneName')?.value;
      return [{ value: zone, label: label || zone, description: `${zone} · ${offset}`, keywords: [zone.replaceAll('_', ' '), aliases[zone] || ''] }];
    } catch { return []; }
  });
}

// Preserve UNC shares, POSIX root and drive root when navigating up.
export function parentDirectory(value) {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized || /^[a-z]:$/i.test(normalized) || /^\/\/[^/]+\/[^/]+$/.test(normalized)) return '';
  const index = normalized.lastIndexOf('/');
  if (index === 0) return '/';
  const parent = normalized.slice(0, index);
  return /^[a-z]:$/i.test(parent) ? `${parent}/` : parent;
}
