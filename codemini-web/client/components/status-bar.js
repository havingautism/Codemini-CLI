import { h } from '../utils/dom.js';
import { t } from '../i18n/index.js';

export function createStatusBar(container) {
  const state = {};

  const brand = h('span', { className: 'brand' }, t('brand'));
  const modelPill = h('span', { className: 'status-pill pill-blue' }, '-');
  const providerPill = h('span', { className: 'status-pill pill-gray' }, '-');
  const modePill = h('span', { className: 'status-pill pill-green' }, 'AUTO');
  const sessionPill = h('span', { className: 'status-pill pill-gray' }, '-');
  const spacer = h('span', { className: 'status-spacer' });
  const liveIndicator = h('span', { className: 'status-live' },
    h('span', { className: 'status-dot' }),
    h('span', {}, t('idle'))
  );
  const contextMeter = h('span', { className: 'context-meter' },
    h('span', {}, 'CTX'),
    h('span', { className: 'context-bar' },
      h('span', { className: 'context-fill', style: { width: '0%', background: 'var(--accent-green)' } })
    ),
    h('span', {}, '0%')
  );

  container.className = 'status-bar';
  container.append(brand, modelPill, providerPill, modePill, sessionPill, spacer, contextMeter, liveIndicator);

  return {
    updateRuntimeState(rs) {
      if (!rs) return;
      if (rs.model) modelPill.textContent = rs.model;
      if (rs.sdkProvider) providerPill.textContent = rs.sdkProvider;
      const mode = rs.mode || 'auto';
      modePill.textContent = mode.toUpperCase();
      modePill.className = `status-pill ${mode === 'plan' ? 'pill-purple' : 'pill-green'}`;
      if (rs.sessionId) sessionPill.textContent = rs.sessionId.slice(-8);
      if (rs.maxContextTokens) {
        const used = rs.currentContextTokens || 0;
        const max = rs.maxContextTokens;
        const pct = Math.round((used / max) * 100);
        const fill = contextMeter.querySelector('.context-fill');
        fill.style.width = pct + '%';
        fill.style.background = pct < 40 ? 'var(--accent-green)' : pct < 75 ? 'var(--accent-orange)' : 'var(--accent-red)';
        contextMeter.lastChild.textContent = pct + '%';
      }
    },
    setLive(live, stageLabel) {
      const dot = liveIndicator.querySelector('.status-dot');
      const label = liveIndicator.lastChild;
      dot.className = live ? 'status-dot live' : 'status-dot';
      label.textContent = live ? (stageLabel || t('live')) : t('idle');
    }
  };
}
