import { h, clear, escapeHtml } from '../utils/dom.js';
import { formatTimestamp } from '../utils/time.js';

export function createSessionPanel(container, { onSwitch, onNew }) {
  return { container, onSwitch, onNew };
}

export function renderSessions(panel, sessions, currentId) {
  const { container, onSwitch, onNew } = panel;
  clear(container);

  const wrapper = h('div', { className: 'panel' });
  wrapper.appendChild(h('div', { className: 'panel-title' }, 'Sessions'));
  wrapper.appendChild(h('div', { className: 'action-row' },
    h('button', { className: 'btn-primary', onClick: () => onNew() }, '+ New Session')
  ));

  const listEl = h('div', { className: 'panel-section' });

  if (!sessions || !sessions.length) {
    listEl.appendChild(h('div', { style: { color: 'var(--text-muted)', fontSize: '13px', padding: '16px 0', textAlign: 'center' } }, 'No sessions found.'));
  } else {
    for (const s of sessions) {
      const isActive = s.id === currentId;
      const card = h('div', { className: `session-card ${isActive ? 'active' : ''}` },
        h('span', { className: 'session-id' }, (s.id || '').slice(-12)),
        h('div', { className: 'session-info-col' },
          h('span', { className: 'session-info' }, escapeHtml(s.title || (s.messageCount > 0 ? `${s.messageCount} messages` : 'Empty'))),
          s.preview ? h('div', { className: 'session-preview' }, escapeHtml(s.preview)) : null
        ),
        h('span', { className: 'session-msgs' }, isActive ? 'Current' : ''),
        h('span', { className: 'session-time' }, s.updatedAt ? formatTimestamp(s.updatedAt) : '')
      );
      if (!isActive) {
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => {
          if (confirm(`Switch to session ${(s.id || '').slice(-8)}?`)) {
            onSwitch(s.id);
          }
        });
      }
      listEl.appendChild(card);
    }
  }

  wrapper.appendChild(listEl);
  container.appendChild(wrapper);
}
