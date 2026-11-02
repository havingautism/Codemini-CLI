import { useEffect, useMemo, useState } from 'react';
import { fetchSessionTokenUsage } from '../hooks/use-api.js';
import { buildSessionContextStats, tokenSegments } from '../lib/session-context-stats.js';
import { formatTrajectoryDuration } from '../lib/session-trajectory.js';
import { t, getLocale } from '../../i18n/index.js';
import './session-context.css';

const number = (value) => Number(value || 0).toLocaleString(getLocale() === 'zh' ? 'zh-CN' : 'en-US');
const compact = (value) => new Intl.NumberFormat(getLocale() === 'zh' ? 'zh-CN' : 'en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0);

function Metric({ label, value, detail }) {
  return <div className="session-context__metric"><span>{label}</span><strong>{value}</strong>{detail ? <small>{detail}</small> : null}</div>;
}

export function SessionContextPanel({ sessionId, messages, busy }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const stats = useMemo(() => buildSessionContextStats(messages), [messages]);
  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    let inFlight = false;
    const refresh = async () => {
      if (document.hidden || inFlight) return;
      inFlight = true;
      try {
        const payload = await fetchSessionTokenUsage(sessionId, controller.signal);
        if (!controller.signal.aborted) { setData(payload); setFailed(false); }
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      } finally { inFlight = false; }
    };
    refresh();
    const timer = window.setInterval(refresh, busy ? 5000 : 30000);
    document.addEventListener('visibilitychange', refresh);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [sessionId, busy, revision]);
  const totals = data?.totals;
  const segments = useMemo(() => tokenSegments(totals || {}), [totals]);
  const chartTotal = segments.reduce((sum, segment) => sum + segment.value, 0);
  let offset = 0;
  const gradient = segments.filter((segment) => segment.value > 0).map((segment) => {
    const start = offset;
    offset += segment.value / chartTotal * 100;
    return `${segment.color} ${start}% ${offset}%`;
  }).join(', ');
  const cacheRate = totals?.cacheReportedInputTokens > 0
    ? `${(totals.cachedInputTokens / totals.cacheReportedInputTokens * 100).toFixed(1)}%` : '—';
  const requestMax = Math.max(1, ...(data?.recent || []).map((request) => request.totalTokens));
  return (
    <section className="session-context" aria-label={t('contextTab')}>
      <header className="session-context__header">
        <div><h2>{t('contextTitle')}</h2><p>{t('contextScope')}</p></div>
        <button type="button" onClick={() => setRevision((value) => value + 1)}>{t('contextRefresh')}</button>
      </header>
      {!sessionId ? <p role="status">{t('contextEmptySession')}</p> : null}
      {failed ? <p role="alert" className="session-context__error">{t('contextError')}</p> : null}
      {sessionId && !data && !failed ? <p role="status">{t('tokenActivityLoading')}</p> : null}
      {totals ? <>
        <div className="session-context__overview">
          <Metric label={t('contextTurns')} value={number(stats.turns)} detail={t('contextTranscript')} />
          <Metric label={t('contextRequests')} value={number(totals.requests)} detail={`${number(totals.reportedRequests)} ${t('contextReported')}`} />
          <Metric label={t('contextTools')} value={number(stats.calls)} detail={`${number(stats.skills)} ${t('contextSkills')}`} />
          <Metric label={t('contextCacheRate')} value={cacheRate} detail={`${number(totals.cacheReportedRequests)} ${t('contextCacheCoverage')}`} />
        </div>
        {!totals.requests ? <p className="session-context__note">{t('contextNoRecords')}</p> : null}
        <div className="session-context__grid">
          <article className="session-context__card">
            <h3>{t('contextTokens')}</h3>
            <div className="session-context__token-body">
              <div className="session-context__donut" style={{ background: gradient ? `conic-gradient(${gradient})` : 'var(--bg-hover)' }} role="img" aria-label={`${t('contextTotal')}: ${number(totals.totalTokens)} tokens`}>
                <div><strong title={number(totals.totalTokens)}>{compact(totals.totalTokens)}</strong><small>{t('contextTotal')}</small></div>
              </div>
              <dl className="session-context__legend">{segments.map((segment) => <div key={segment.key}>
                <dt><i style={{ background: segment.color }} />{t(segment.key)}</dt>
                <dd title={number(segment.value)}>{compact(segment.value)}<small>{chartTotal ? `${(segment.value / chartTotal * 100).toFixed(1)}%` : '—'}</small></dd>
              </div>)}</dl>
            </div>
            <p className="session-context__note">{t('contextTokenNote')}</p>
          </article>
          <article className="session-context__card">
            <h3>{t('contextTiming')}</h3>
            <div className="session-context__timing">
              <Metric label={t('contextModelTime')} value={formatTrajectoryDuration(totals.durationMs)} detail={`${number(totals.timedRequests)} ${t('contextTimedRequests')}`} />
              <Metric label={t('contextWaiting')} value={formatTrajectoryDuration(totals.waitingMs)} />
              <Metric label={t('contextGenerating')} value={formatTrajectoryDuration(totals.generatingMs)} detail={`${number(totals.splitTimedRequests)} ${t('contextTimedRequests')}`} />
              <Metric label={t('contextToolTime')} value={formatTrajectoryDuration(stats.toolDurationMs)} detail={`${number(stats.timedTools)} / ${number(stats.calls)} ${t('contextTools')}`} />
            </div>
            <p className="session-context__note">{t('contextTimingNote')}</p>
          </article>
          <article className="session-context__card">
            <h3>{t('contextModels')}</h3>
            {data.models.length ? <div className="session-context__table-scroll"><table><thead><tr><th>{t('contextModel')}</th><th>{t('contextRequests')}</th><th>Tokens</th></tr></thead><tbody>{data.models.map((model) => <tr key={`${model.provider}/${model.model}`}><td><span>{model.model || '—'}</span><small>{model.provider}</small></td><td>{number(model.requests)}</td><td>{number(model.totalTokens)}</td></tr>)}</tbody></table></div> : <p className="session-context__note">{t('contextNoRecords')}</p>}
          </article>
          <article className="session-context__card">
            <h3>{t('contextTools')}</h3>
            {stats.tools.length ? <dl className="session-context__tools">{stats.tools.map((tool) => <div key={tool.name}><dt>{tool.name}</dt><dd>{number(tool.count)}</dd></div>)}</dl> : <p className="session-context__note">{t('contextNoTools')}</p>}
            <p className="session-context__note">{t('contextTranscriptNote')}</p>
          </article>
        </div>
        {data.recent.length ? <article className="session-context__card session-context__recent">
          <h3>{t('contextRecent')}</h3>
          <div className="session-context__bars" role="list" aria-label={t('contextRecent')}>{data.recent.map((request) => {
            const label = `${new Date(request.createdAt).toLocaleString()} · ${request.model} · ${request.reported ? `${number(request.totalTokens)} tokens` : t('contextUnreported')}`;
            return <div key={request.id} role="listitem" tabIndex={0} title={label} aria-label={label} style={{ height: `${Math.max(4, request.totalTokens / requestMax * 100)}%` }} data-reported={Boolean(request.reported)} />;
          })}</div>
          <p className="session-context__note">{t('contextRecentNote')}</p>
        </article> : null}
        <p className="session-context__note" role="status">{t('contextCoverageNote')}{totals.requests > totals.reportedRequests ? ` ${number(totals.requests - totals.reportedRequests)} ${t('contextUnreported')}` : ''}</p>
      </> : null}
    </section>
  );
}
