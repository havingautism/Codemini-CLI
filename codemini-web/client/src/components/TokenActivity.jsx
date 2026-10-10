import { useEffect, useMemo, useState } from 'react';
import { fetchTokenActivity } from '../hooks/use-api.js';
import { buildActivityGrid } from '../lib/token-activity.js';
import { t, getLocale } from '../../i18n/index.js';

export function TokenActivity() {
  const [activity, setActivity] = useState(null);
  const [failed, setFailed] = useState(false);
  const [weekly, setWeekly] = useState(false);
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      if (document.hidden) return;
      fetchTokenActivity(controller.signal).then((data) => {
        if (!controller.signal.aborted) { setActivity(data); setFailed(false); }
      }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    };
    refresh();
    const timer = window.setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', refresh);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  const grid = useMemo(() => buildActivityGrid(activity, weekly), [activity, weekly]);
  const number = (value) => Number(value || 0).toLocaleString(getLocale() === 'zh' ? 'zh-CN' : 'en-US');
  const cellLabel = (cell) => `${cell.date}${cell.end ? ` – ${cell.end}` : ''} · ${number(cell.totalTokens)} tokens · ${number(cell.requests)} ${t('tokenActivityRequests')}${cell.unreportedRequests ? ` · ${number(cell.unreportedRequests)} ${t('tokenActivityUnreported')}` : ''}`;
  return (
    <section className="codemini-token-activity" aria-label={t('tokenActivityTitle')}>
      <div className="codemini-token-activity__header">
        <h2>{t('tokenActivityTitle')}</h2>
        <div className="codemini-token-activity__controls" aria-label={t('tokenActivityPeriod')}>
          <button type="button" aria-pressed={!weekly} onClick={() => { setWeekly(false); setSelected(null); }}>{t('tokenActivityDaily')}</button>
          <button type="button" aria-pressed={weekly} onClick={() => { setWeekly(true); setSelected(null); }}>{t('tokenActivityWeekly')}</button>
        </div>
      </div>
      {!activity ? <p className="codemini-token-activity__status" role="status">{t(failed ? 'tokenActivityError' : 'tokenActivityLoading')}</p> : <>
        <div className="codemini-token-activity__scroll" tabIndex={0} aria-label={t('tokenActivityTitle')}>
          <div className="codemini-token-activity__chart" style={{ '--activity-columns': grid.weeks.length }}>
            <div className="codemini-token-activity__grid" data-weekly={weekly}>
              {grid.weeks.map((week, index) => <div className="codemini-token-activity__week" key={index}>
                {week.map((cell) => <span key={cell.date} className="codemini-token-activity__cell" data-level={cell.level} data-outside={cell.outside || undefined}
                  tabIndex={!cell.outside && cell.requests > 0 ? 0 : undefined} role={!cell.outside ? 'img' : undefined}
                  aria-label={!cell.outside ? cellLabel(cell) : undefined} title={!cell.outside ? cellLabel(cell) : undefined}
                  onMouseEnter={() => !cell.outside && setSelected(cell)} onMouseLeave={() => setSelected(null)}
                  onFocus={() => setSelected(cell)} onBlur={() => setSelected(null)} />)}
              </div>)}
            </div>
            <div className="codemini-token-activity__months">{grid.months.map(({ column, month }) => <span key={column} style={{ gridColumn: column + 1 }}>{getLocale() === 'zh' ? `${month}月` : new Date(2020, month - 1).toLocaleString('en', { month: 'short' })}</span>)}</div>
          </div>
        </div>
        <div className="codemini-token-activity__footer">
          <span>{t('tokenActivityTotal')} <strong>{number(activity.lifetime.totalTokens)}</strong> tokens</span>
          <span className="codemini-token-activity__legend">{t('tokenActivityLess')}{[0, 1, 2, 3, 4].map((level) => <i key={level} className="codemini-token-activity__cell" data-level={level} aria-hidden="true" />)}{t('tokenActivityMore')}</span>
        </div>
        <p className="codemini-token-activity__detail" aria-live="polite">{selected ? cellLabel(selected) : failed ? t('tokenActivityError') : t('tokenActivityNote')}{!selected && activity.unreportedRequests > 0 ? ` · ${number(activity.unreportedRequests)} ${t('tokenActivityUnreported')}` : ''}</p>
      </>}
    </section>
  );
}
