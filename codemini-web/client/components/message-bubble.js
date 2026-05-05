import { h, clear, escapeHtml } from '../utils/dom.js';
import { formatTimestamp } from '../utils/time.js';
import { renderStreamdown } from './streamdown-renderer.jsx';
import { createToolCard, updateToolCard } from './tool-card.js';
import { t } from '../i18n/index.js';

const ROLE_STYLES = {
  you:       { badge: 'pill-blue',    label: 'You' },
  general:   { badge: 'pill-green',   label: 'General' },
  coder:     { badge: 'pill-green',   label: 'Coder' },
  advisor:   { badge: 'pill-blue',    label: 'Advisor' },
  planner:   { badge: 'pill-purple',  label: 'Planner' },
  reviewer:  { badge: 'pill-orange',  label: 'Reviewer' },
  tester:    { badge: 'pill-blue',    label: 'Tester' },
  summarizer:{ badge: 'pill-cyan',    label: 'Summarizer' },
  system:    { badge: 'pill-gray',    label: 'System' },
  error:     { badge: 'pill-red',     label: 'Error' },
  pending:   { badge: 'pill-cyan',    label: 'Pending' },
};

export function createMessageBubble(msg) {
  const role = msg.role || 'general';
  const style = ROLE_STYLES[role] || ROLE_STYLES.general;
  const isSystem = role === 'system';
  const ts = msg.timestamp ? formatTimestamp(msg.timestamp) : '';

  if (isSystem) {
    return h('div', { className: 'msg-system' },
      h('div', { className: 'msg-system-inner' }, escapeHtml(msg.text || ''))
    );
  }

  const wrapper = h('div', { className: `message-wrapper role-${role}` });
  const bubble = h('div', { className: 'message-bubble' });

  const header = h('div', { className: 'msg-header' },
    h('span', { className: `role-badge ${style.badge}` }, style.label),
    ts ? h('span', { className: 'msg-time' }, ts) : null
  );
  bubble.appendChild(header);

  const body = h('div', { className: 'msg-body' });
  bubble.appendChild(body);

  wrapper.appendChild(bubble);

  wrapper._body = body;
  wrapper._bubble = bubble;
  wrapper._toolCards = new Map();
  wrapper._toolContainer = null;
  wrapper._toolOrder = [];
  wrapper._currentToolBlock = [];
  wrapper._currentText = '';
  wrapper._isStreaming = false;

  if (msg.text) {
    wrapper._currentText = msg.text;
    renderStreamdown(body, msg.text);
  }

  if (msg.tools && msg.tools.length) {
    for (const tool of msg.tools) {
      const card = createToolCard(tool);
      bubble.appendChild(card);
      wrapper._toolCards.set(tool.id, card);
    }
  }

  return wrapper;
}

export function startTextSegment(wrapper) {
  if (!wrapper) return null;
  wrapper._toolContainer = null;
  wrapper._currentToolBlock = [];
  const body = h('div', { className: 'msg-body' });
  wrapper._bubble.appendChild(body);
  wrapper._body = body;
  wrapper._currentText = '';
  wrapper._isStreaming = false;
  return body;
}

export function appendDelta(wrapper, text) {
  if (!wrapper || !text) return;
  wrapper._currentText += text;
  wrapper._isStreaming = true;
  renderStreamdown(wrapper._body, wrapper._currentText, { streaming: true });
}

export function finishStreaming(wrapper) {
  if (!wrapper) return;
  wrapper._isStreaming = false;
  renderStreamdown(wrapper._body, wrapper._currentText, { streaming: false });
}

const TOOL_COLLAPSE_THRESHOLD = 3;

function ensureToolContainer(wrapper) {
  const needsContainer = !wrapper._toolContainer || wrapper._toolContainer.parentElement !== wrapper._bubble || wrapper._bubble.lastElementChild !== wrapper._toolContainer;
  if (needsContainer) {
    const container = h('div', { className: 'tool-cards-container' });
    wrapper._bubble.appendChild(container);
    wrapper._toolContainer = container;
  }
  return wrapper._toolContainer;
}

function refreshToolCollapse(wrapper, cards = wrapper?._currentToolBlock || []) {
  if (!wrapper) return;
  const total = cards.length;
  const parents = new Set(cards.map((card) => card.parentElement).filter(Boolean));
  for (const parent of parents) {
    for (const toggle of parent.querySelectorAll('.tool-collapse-toggle')) toggle.remove();
  }

  if (total <= TOOL_COLLAPSE_THRESHOLD) {
    for (const card of cards) card.classList.remove('hidden');
    return;
  }

  if (cards._toolsExpanded) {
    for (const card of cards) card.classList.remove('hidden');
    const blockCards = cards;
    const toggle = h('button', {
      className: 'tool-collapse-toggle',
      type: 'button',
      onClick: () => {
        blockCards._toolsExpanded = false;
        refreshToolCollapse(wrapper, blockCards);
      }
    }, `Collapse ${total - TOOL_COLLAPSE_THRESHOLD} older tool calls`);
    cards[0].parentElement?.insertBefore(toggle, cards[0]);
    return;
  }

  // Hide older calls and keep the latest calls visible, matching the TUI flow.
  const hideCount = total - TOOL_COLLAPSE_THRESHOLD;
  for (let i = 0; i < hideCount; i++) cards[i].classList.add('hidden');
  for (let i = hideCount; i < total; i++) cards[i].classList.remove('hidden');
  const blockCards = cards;
  const toggle = h('button', {
    className: 'tool-collapse-toggle',
    type: 'button',
    onClick: () => {
      blockCards._toolsExpanded = true;
      refreshToolCollapse(wrapper, blockCards);
    }
  }, `+${hideCount} more tool calls`);
  cards[hideCount].parentElement?.insertBefore(toggle, cards[hideCount]);
}

export function addToolCard(wrapper, event) {
  if (!wrapper) return;
  if (wrapper._toolCards.has(event.id)) return wrapper._toolCards.get(event.id);
  const container = ensureToolContainer(wrapper);
  const card = createToolCard(event);
  container.appendChild(card);
  wrapper._toolCards.set(event.id, card);
  wrapper._toolOrder.push(card);
  if (!Array.isArray(wrapper._currentToolBlock)) wrapper._currentToolBlock = [];
  wrapper._currentToolBlock.push(card);
  refreshToolCollapse(wrapper, wrapper._currentToolBlock);
  return card;
}

export function updateToolInMessage(wrapper, event) {
  if (!wrapper) return;
  let card = wrapper._toolCards.get(event.id);
  if (!card && event.id && event.name) {
    card = addToolCard(wrapper, event);
  }
  if (card) updateToolCard(card, event);
}

export function addSkillBadge(wrapper, name, status) {
  if (!wrapper) return;
  const badge = h('span', { className: `skill-badge ${status}` },
    status === 'auto' ? `${t('skillAuto')}: ${name}` : `${name} - ${t('skill' + status.charAt(0).toUpperCase() + status.slice(1))}`
  );
  wrapper._bubble.appendChild(badge);
}

export function addFileChanges(wrapper, changes) {
  if (!wrapper || !changes || !changes.length) return;
  const container = h('div', { className: 'file-changes' },
    h('div', { style: { fontWeight: 600, fontSize: '12px', marginBottom: '4px', color: 'var(--text-secondary)' } }, t('fileChanges')),
    ...changes.map(c => {
      const actionClass = { edit: 'edit', create: 'create', delete: 'delete' }[c.action] || 'edit';
      return h('div', { className: 'file-change-row' },
        h('span', { className: `fc-action ${actionClass}` }, c.action.toUpperCase()),
        h('span', { className: 'fc-path' }, escapeHtml(c.path)),
        c.linesAdded != null ? h('span', { className: 'fc-added' }, `+${c.linesAdded}`) : null,
        c.linesRemoved != null ? h('span', { className: 'fc-removed' }, `-${c.linesRemoved}`) : null
      );
    })
  );
  wrapper._bubble.appendChild(container);
}
