import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchTokenActivity } from '../hooks/use-api.js';
import { buildActivityGrid } from '../lib/token-activity.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CaretDown } from '@/lib/icons';
import { t, getLocale } from '../../i18n/index.js';

function viewerCalendar() {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(new Date()).map(({ type, value }) => [type, value]));
  return { year: Number(parts.year), month: Number(parts.month) };
}

function monthLabel(month) {
  return getLocale() === 'zh' ? `${month}月` : new Date(2020, month - 1).toLocaleString('en', { month: 'short' });
}

function FilterMenu({ label, value, options, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value) || options[0];
  return (
    <div className="codemini-token-activity__filter">
      <span>{label}</span>
      <Popover open={disabled ? false : open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="codemini-token-activity__filter-trigger" aria-label={label} disabled={disabled}>
            <span>{current?.label}</span>
            <CaretDown size={12} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="codemini-token-activity__filter-menu">
          {options.map((option) => (
            <button type="button" key={String(option.value)} aria-pressed={option.value === value} onClick={() => { onChange(option.value); setOpen(false); }}>
              {option.label}
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function placeTip(event, cell, setSelected) {
  const host = event.currentTarget.closest('.codemini-token-activity');
  if (!host) return;
  const hostBox = host.getBoundingClientRect();
  const box = event.currentTarget.getBoundingClientRect();
  const center = box.left + box.width / 2 - hostBox.left;
  const x = Math.min(hostBox.width - 96, Math.max(96, center));
  setSelected({ ...cell, x, y: box.top - hostBox.top });
}

function usageParts(cell = {}) {
  const input = Math.max(0, Number(cell.inputTokens) || 0);
  const cached = Math.min(input, Math.max(0, Number(cell.cachedInputTokens) || 0));
  const fresh = Math.max(0, input - cached);
  const output = Math.max(0, Number(cell.outputTokens) || 0);
  const write = Math.max(0, Number(cell.cacheWriteInputTokens) || 0);
  const known = cached + fresh + output;
  const total = Math.max(Number(cell.totalTokens) || 0, known);
  return { cached, fresh, output, write, unspecified: known > 0 ? 0 : total, total };
}

function UsageTip({ cell, number }) {
  if (!cell) return null;
  const parts = usageParts(cell);
  const when = cell.end && cell.end !== cell.date ? `${cell.date.slice(5)} – ${cell.end.slice(5)}` : cell.date;
  const rows = [
    ['hit', t('tokenActivityInputCached'), parts.cached],
    ['fresh', t('tokenActivityInputFresh'), parts.fresh],
    ['output', t('tokenActivityOutput'), parts.output],
  ];
  return (
    <div className="codemini-token-activity__tooltip" style={{ left: cell.x, top: cell.y }} role="tooltip">
      <div className="codemini-token-activity__tooltip-head">
        <strong>{when}</strong>
        <strong>{number(parts.total)}</strong>
      </div>
      {rows.map(([part, label, value]) => (
        <div className="codemini-token-activity__tooltip-row" key={part}>
          <i data-part={part} />
          <span>{label}</span>
          <b>{number(value)}</b>
        </div>
      ))}
      {parts.write > 0 ? <div className="codemini-token-activity__tooltip-note">{t('tokenActivityCacheWrite')} {number(parts.write)}</div> : null}
      <div className="codemini-token-activity__tooltip-note">{number(cell.requests)} {t('tokenActivityRequests')}{cell.unreportedRequests > 0 ? ` · ${number(cell.unreportedRequests)} ${t('tokenActivityUnreported')}` : ''}</div>
    </div>
  );
}

function axisCeiling(max) {
  if (!(max > 0)) return 1;
  // The middle tick is half the top, so round that half up to a readable step.
  const half = max / 2;
  const power = 10 ** Math.floor(Math.log10(half));
  const fraction = half / power;
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((value) => fraction <= value) || 10;
  return step * power * 2;
}

function formatAxis(value) {
  const amount = Number(value) || 0;
  const locale = getLocale() === 'zh' ? 'zh-CN' : 'en-US';
  const units = locale === 'zh-CN'
    ? [{ size: 1e8, suffix: '亿' }, { size: 1e4, suffix: '万' }]
    : [{ size: 1e9, suffix: 'B' }, { size: 1e6, suffix: 'M' }, { size: 1e3, suffix: 'k' }];
  const unit = units.find((item) => Math.abs(amount) >= item.size);
  if (!unit) return amount.toLocaleString(locale);
  const scaled = amount / unit.size;
  const digits = scaled >= 10 ? 0 : 1;
  return `${scaled.toFixed(digits).replace(/\.0$/, '')}${unit.suffix}`;
}

function ActivityBars({ points, selectedDate, onHover }) {
  if (!points.length) return null;
  const width = 640;
  const height = 156;
  const pad = { left: 42, right: 8, top: 18, bottom: 22 };
  const slot = (width - pad.left - pad.right) / points.length;
  const barWidth = Math.max(4, Math.min(22, slot * 0.62));
  const ceiling = axisCeiling(Math.max(0, ...points.map((point) => usageParts(point).total)));
  const max = ceiling;
  const baseline = height - pad.bottom;
  const plotHeight = baseline - pad.top;
  const labels = points.length <= 8 ? points.map((_, index) => index) : points.map((_, index) => index).filter((index) => Number(points[index].date.slice(8, 10)) % 5 === 1);
  const ticks = [ceiling, ceiling / 2, 0];
  return (
    <svg className="codemini-token-activity__bars" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t('tokenActivityMonths')} onMouseLeave={() => onHover(null)}>
      {ticks.map((tick) => {
        const y = baseline - (tick / ceiling) * plotHeight;
        return (
          <g key={tick}>
            <text className="codemini-token-activity__bars-axis" x={pad.left - 6} y={y + 3} textAnchor="end">{formatAxis(tick)}</text>
            <line className="codemini-token-activity__bars-grid" x1={pad.left} x2={width - pad.right} y1={y} y2={y} />
          </g>
        );
      })}
      {points.map((point, index) => {
        const x = pad.left + slot * index + (slot - barWidth) / 2;
        const parts = usageParts(point);
        const active = selectedDate === point.date;
        let top = baseline;
        const segments = ['output', 'fresh', 'cached', 'unspecified'].map((part) => {
          const value = part === 'cached' ? parts.cached : part === 'fresh' ? parts.fresh : part === 'output' ? parts.output : parts.unspecified;
          const heightPx = value > 0 ? Math.max(1, (value / max) * plotHeight) : 0;
          top -= heightPx;
          return { part, y: top, heightPx };
        }).filter((segment) => segment.heightPx > 0);
        return (
          <g key={point.date}>
            {segments.map((segment) => <rect key={segment.part} className="codemini-token-activity__bar" data-part={segment.part} data-active={active || undefined} x={x} y={segment.y} width={barWidth} height={segment.heightPx} rx="1.5" />)}
            <rect className="codemini-token-activity__bar-hit" x={pad.left + slot * index} y={pad.top} width={slot} height={plotHeight}
              tabIndex={0} aria-label={point.date} data-active={active || undefined}
              onMouseEnter={(event) => placeTip(event, point, onHover)} onFocus={(event) => placeTip(event, point, onHover)}
              onBlur={(event) => { if (!event.currentTarget.ownerSVGElement?.contains(event.relatedTarget)) onHover(null); }} />
          </g>
        );
      })}
      {labels.map((index) => {
        const point = points[index];
        const text = point.end ? `${Number(point.date.slice(5, 7))}/${Number(point.date.slice(8, 10))}` : String(Number(point.date.slice(8, 10)));
        return <text key={`${point.date}-label`} className="codemini-token-activity__bars-axis" x={pad.left + slot * index + slot / 2} y={height - 6} textAnchor="middle">{text}</text>;
      })}
    </svg>
  );
}

export function TokenActivity() {
  const [{ year: currentYear, month: currentMonth }] = useState(viewerCalendar);
  const [activity, setActivity] = useState(null);
  const [failed, setFailed] = useState(false);
  const [weekly, setWeekly] = useState(false);
  const [selected, setSelected] = useState(null);
  const [year, setYear] = useState(null);
  const [month, setMonth] = useState(null);
  const scrollRef = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      if (document.hidden) return;
      fetchTokenActivity(controller.signal, { year, month: year ? month : null }).then((data) => {
        if (!controller.signal.aborted) { setActivity(data); setFailed(false); }
      }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    };
    refresh();
    const timer = window.setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', refresh);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [year, month]);
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return undefined;
    const showLatest = () => { node.scrollLeft = node.scrollWidth; };
    showLatest();
    const observer = new ResizeObserver(showLatest);
    observer.observe(node);
    return () => observer.disconnect();
  }, [activity, weekly, year, month]);
  const grid = useMemo(() => buildActivityGrid(activity, Boolean(weekly && !month)), [activity, weekly, month]);
  const series = useMemo(() => buildActivityGrid(activity, weekly).weeks.flat().filter((cell) => !cell.outside && cell.date), [activity, weekly]);
  const number = (value) => Number(value || 0).toLocaleString(getLocale() === 'zh' ? 'zh-CN' : 'en-US');
  const years = activity?.years?.length ? activity.years : [currentYear];
  const monthCount = year === currentYear ? currentMonth : 12;
  const chooseYear = (value) => {
    setYear(value);
    if (value == null || (value === currentYear && month > currentMonth)) setMonth(null);
    setSelected(null);
  };
  const period = !year
    ? t('tokenActivityRecentYear')
    : month
      ? (getLocale() === 'zh' ? `${year}年${monthLabel(month)}` : `${monthLabel(month)} ${year}`)
      : (getLocale() === 'zh' ? `${year}年` : String(year));
  return (
    <section className="codemini-token-activity" aria-label={t('tokenActivityTitle')}>
      <div className="codemini-token-activity__header">
        <h2>{t('tokenActivityTitle')}</h2>
        <div className="codemini-token-activity__controls" role="group" aria-label={t('tokenActivityPeriod')}>
          <button type="button" aria-pressed={!weekly} onClick={() => { setWeekly(false); setSelected(null); }}>{t('tokenActivityDaily')}</button>
          <button type="button" aria-pressed={weekly} onClick={() => { setWeekly(true); setSelected(null); }}>{t('tokenActivityWeekly')}</button>
        </div>
      </div>
      {!activity ? <p className="codemini-token-activity__status" role="status">{t(failed ? 'tokenActivityError' : 'tokenActivityLoading')}</p> : <>
        <div className="codemini-token-activity__filters">
          <FilterMenu label={t('tokenActivityYears')} value={year} onChange={chooseYear}
            options={[{ value: null, label: t('tokenActivityRecentYear') }, ...years.map((value) => ({ value, label: String(value) }))]} />
          <FilterMenu label={t('tokenActivityMonths')} value={month} disabled={!year} onChange={(value) => { setMonth(value); setSelected(null); }}
            options={[{ value: null, label: t('tokenActivityAllMonths') }, ...Array.from({ length: monthCount }, (_, index) => ({ value: index + 1, label: monthLabel(index + 1) }))]} />
        </div>
        {month ? <ActivityBars points={series} selectedDate={selected?.date} onHover={setSelected} /> : <div className="codemini-token-activity__plot" onMouseLeave={() => setSelected(null)}>
          <div className="codemini-token-activity__scroll" ref={scrollRef} tabIndex={0} aria-label={t('tokenActivityTitle')}>
            <div className="codemini-token-activity__chart" style={{ '--activity-columns': grid.weeks.length }}>
              <div className="codemini-token-activity__months" aria-hidden="true">
                {grid.months.map(({ column, month: monthNumber }) => <span key={`${column}-${monthNumber}`} style={{ gridColumn: column + 1 }}>{monthLabel(monthNumber)}</span>)}
              </div>
              <div className="codemini-token-activity__grid" data-weekly={weekly || undefined}>
                {grid.weeks.map((week, index) => <div className="codemini-token-activity__week" key={index}>
                  {week.map((cell) => <span key={cell.date || index} className="codemini-token-activity__cell" data-level={cell.outside ? 0 : cell.level} data-active={!cell.outside && selected?.date === cell.date ? 'true' : undefined}
                    tabIndex={!cell.outside ? 0 : undefined} role={!cell.outside ? 'img' : undefined}
                    aria-label={!cell.outside ? cell.date : undefined}
                    onMouseEnter={(event) => !cell.outside && placeTip(event, cell, setSelected)}
                    onFocus={(event) => !cell.outside && placeTip(event, cell, setSelected)}
                    onBlur={(event) => { if (!event.currentTarget.closest('.codemini-token-activity__plot')?.contains(event.relatedTarget)) setSelected(null); }} />)}
                </div>)}
              </div>
            </div>
          </div>
        </div>}
        <UsageTip cell={selected} number={number} />
        <div className="codemini-token-activity__footer">
          <span>{t('tokenActivityTotal')} <strong>{number(activity.lifetime.totalTokens)}</strong> tokens</span>
          {month ? <span className="codemini-token-activity__legend">
            <i data-part="hit" />{t('tokenActivityInputCached')}
            <i data-part="fresh" />{t('tokenActivityInputFresh')}
            <i data-part="output" />{t('tokenActivityOutput')}
          </span> : <span className="codemini-token-activity__legend">{t('tokenActivityLess')}{[0, 1, 2, 3, 4].map((level) => <i key={level} className="codemini-token-activity__cell" data-level={level} aria-hidden="true" />)}{t('tokenActivityMore')}</span>}
        </div>
        <p className="codemini-token-activity__detail" aria-live="polite">{failed ? t('tokenActivityError') : `${period} · ${t('tokenActivityNote')}`}{activity.unreportedRequests > 0 ? ` · ${number(activity.unreportedRequests)} ${t('tokenActivityUnreported')}` : ''}</p>
      </>}
    </section>
  );
}
