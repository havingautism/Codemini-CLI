import { h } from '../utils/dom.js';
import { t } from '../i18n/index.js';
import { icon } from '../utils/icons.js';

export function createStatusBar(container) {
  const state = {};

  const brand = h('span', { className: 'brand' }, t('brand'));
  const modelLabel = h('span', { className: 'status-label' }, '-');
  const providerLabel = h('span', { className: 'status-label' }, '-');
  const modeLabel = h('span', { className: 'status-label' }, 'AUTO');
  const sessionLabel = h('span', { className: 'status-label' }, '-');
  const modelPill = h('span', { className: 'status-pill pill-blue' }, icon('Monitor', { size: 16 }), modelLabel);
  const providerPill = h('span', { className: 'status-pill pill-gray' }, icon('GitBranch', { size: 16 }), providerLabel);
  const modePill = h('span', { className: 'status-pill pill-green' }, icon('Hash', { size: 16 }), modeLabel);
  const sessionPill = h('span', { className: 'status-pill pill-gray' }, icon('ArrowLeftRight', { size: 16 }), sessionLabel);
  const spacer = h('span', { className: 'status-spacer' });
  const liveIndicator = h('span', { className: 'status-live' },
    icon('Circle', { size: 16 }),
    h('span', { className: 'status-dot' }),
    h('span', { className: 'status-live-label' }, t('idle'))
  );
  const contextLabel = h('span', { className: 'context-value' }, '0%');
  const contextMeter = h('span', { className: 'context-meter' },
    icon('ChartNoAxesCombined', { size: 16 }),
    h('span', {}, 'CTX'),
    h('span', { className: 'context-bar' },
      h('span', { className: 'context-fill', style: { width: '0%', background: 'var(--accent-green)' } })
    ),
    contextLabel
  );

  container.className = 'status-bar';
  container.append(brand, modelPill, providerPill, modePill, sessionPill, spacer, contextMeter, liveIndicator);

  return {
    updateRuntimeState(rs) {
      if (!rs) return;
      if (rs.model) modelLabel.textContent = rs.model;
      if (rs.sdkProvider) providerLabel.textContent = rs.sdkProvider;
      const mode = rs.mode || 'auto';
      modeLabel.textContent = mode.toUpperCase();
      modePill.className = `status-pill ${mode === 'plan' ? 'pill-purple' : 'pill-green'}`;
      if (rs.sessionId) sessionLabel.textContent = rs.sessionId.slice(-8);
      if (rs.maxContextTokens) {
        const used = rs.currentContextTokens || 0;
        const max = rs.maxContextTokens;
        const pct = Math.round((used / max) * 100);
        const fill = contextMeter.querySelector('.context-fill');
        fill.style.width = pct + '%';
        fill.style.background = pct < 40 ? 'var(--accent-green)' : pct < 75 ? 'var(--accent-orange)' : 'var(--accent-red)';
        contextLabel.textContent = pct + '%';
      }
    },
    setLive(live, stageLabel) {
      const dot = liveIndicator.querySelector('.status-dot');
      const label = liveIndicator.querySelector('.status-live-label');
      dot.className = live ? 'status-dot live' : 'status-dot';
      label.textContent = live ? (stageLabel || t('live')) : t('idle');
    }
  };
}
