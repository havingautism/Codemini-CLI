import { h } from '../utils/dom.js';
import { t } from '../i18n/index.js';
import { icon } from '../utils/icons.js';

export function createStatusBar(container) {
  const state = {};

  const brand = h('span', { className: 'brand' }, t('brand'));
  const modelLabel = h('span', { className: 'status-label' }, '-');
  const providerLabel = h('span', { className: 'status-label' }, '-');
  const modeLabel = h('span', { className: 'status-label' }, 'NORMAL');
  const modelPill = h('span', { className: 'status-pill pill-blue' }, icon('Brain', { size: 16 }), modelLabel);
  const providerPill = h('span', { className: 'status-pill pill-gray' }, icon('Plug', { size: 16 }), providerLabel);
  const modePill = h('span', { className: 'status-pill pill-green' }, icon('ShieldCheck', { size: 16 }), modeLabel);
  const liveIndicator = h('span', { className: 'status-live' },
    h('span', { className: 'status-dot idle' }),
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
  container.append(brand, modelPill, providerPill, modePill, contextMeter, liveIndicator);

  const STAGE_COLORS = {
    thinking: 'thinking',
    streaming: 'streaming',
    tooling: 'tooling',
    live: 'live'
  };

  return {
    updateRuntimeState(rs) {
      if (!rs) return;
      if (rs.model) modelLabel.textContent = rs.model;
      if (rs.sdkProvider) providerLabel.textContent = rs.sdkProvider;
      const mode = rs.mode || 'normal';
      modeLabel.textContent = mode.toUpperCase();
      modePill.className = `status-pill ${mode === 'plan' ? 'pill-purple' : 'pill-green'}`;
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
      if (live) {
        const stage = stageLabel || t('live');
        const colorKey = Object.keys(STAGE_COLORS).find(k => stage.includes(k)) || 'live';
        dot.className = `status-dot ${colorKey}`;
        label.textContent = stage;
      } else {
        dot.className = 'status-dot idle';
        label.textContent = t('idle');
      }
    }
  };
}
