import { h, escapeHtml } from '../utils/dom.js';
import { formatDuration } from '../utils/time.js';
import { t } from '../i18n/index.js';

const TOOL_ICONS = {
  read: '\u{1F4D6}',
  edit: '\u{270F}\u{FE0F}',
  write: '\u{1F4DD}',
  delete: '\u{1F5D1}\u{FE0F}',
  run: '\u{2699}\u{FE0F}',
  grep: '\u{1F50D}',
  glob: '\u{1F4C2}',
  list: '\u{1F4C1}',
  web_fetch: '\u{1F310}',
  web_search: '\u{1F50E}',
  default: '\u{1F527}'
};

function extractToolName(name) {
  const match = String(name).match(/^(\w+)/);
  return match ? match[1] : name;
}

function extractKeyArg(args, toolName) {
  if (!args) return '';
  let obj = args;
  if (typeof args === 'string') {
    try { obj = JSON.parse(args); } catch { return args; }
  }
  if (typeof obj !== 'object') return String(obj);
  const keyMap = {
    read: 'path', edit: 'path', write: 'path', delete: 'path',
    run: 'command', grep: 'pattern', glob: 'pattern', list: 'path',
    web_fetch: 'url', web_search: 'query'
  };
  const key = keyMap[toolName];
  if (key && obj[key] != null) return String(obj[key]);
  for (const v of Object.values(obj)) {
    if (typeof v === 'string' && v.length > 0 && v.length < 200) return v;
  }
  return '';
}

export function createToolCard(event) {
  const { name, id, arguments: args } = event;
  const toolName = extractToolName(name);
  const icon = TOOL_ICONS[toolName] || TOOL_ICONS.default;
  const keyArg = extractKeyArg(args, toolName);
  const nameText = keyArg && !String(name).includes('(') ? `${name}(${keyArg})` : name;
  const body = h('div', { className: 'tool-body hidden' });
  renderToolBody(body, { args });

  const card = h('div', { className: 'tool-card', dataset: { toolId: id } },
    h('div', { className: 'tool-header', onClick: () => {
      const body = card.querySelector('.tool-body');
      if (body) body.classList.toggle('hidden');
    }},
      h('span', { className: 'tool-icon' }, icon),
      h('span', { className: 'tool-name' }, escapeHtml(nameText)),
      h('span', { className: 'tool-duration' }),
      h('span', { className: 'tool-status running' })
    ),
    body
  );

  card._statusDot = card.querySelector('.tool-status');
  card._durationEl = card.querySelector('.tool-duration');
  card._bodyEl = body;
  card._args = args;
  card._summary = '';
  card._resultContent = '';
  return card;
}

export function updateToolCard(card, event) {
  const { type } = event;
  if (!card._bodyEl) card._bodyEl = card.querySelector('.tool-body');
  if (event.arguments != null) card._args = event.arguments;

  if (type === 'tool:end') {
    card._statusDot.className = 'tool-status done';
    card._durationEl.textContent = formatDuration(event.durationMs);
    if (event.summary) {
      card._summary = event.summary;
      upsertVisibleSummary(card, event.summary);
    }
    if (event.fileChange) {
      card.appendChild(renderFileChange(event.fileChange));
    }
    renderToolBody(card._bodyEl, { args: card._args, summary: card._summary, result: card._resultContent });
  } else if (type === 'tool:error') {
    card._statusDot.className = 'tool-status error';
    card._durationEl.textContent = formatDuration(event.durationMs);
    if (event.summary) {
      card._summary = event.summary;
      upsertVisibleSummary(card, event.summary);
      card.style.borderColor = 'var(--accent-red)';
    }
    renderToolBody(card._bodyEl, { args: card._args, summary: card._summary, result: card._resultContent });
  } else if (type === 'tool:blocked') {
    card._statusDot.className = 'tool-status blocked';
    card.style.borderColor = 'var(--accent-orange)';
    card._summary = t('toolBlocked');
    upsertVisibleSummary(card, card._summary);
    renderToolBody(card._bodyEl, { args: card._args, summary: card._summary, result: card._resultContent });
  } else if (type === 'tool:result') {
    card._resultContent = event.content || '';
    renderToolBody(card._bodyEl, { args: card._args, summary: card._summary, result: card._resultContent });
  }
}

function upsertVisibleSummary(card, text) {
  if (!card._summaryEl) {
    card._summaryEl = h('div', { className: 'tool-summary' });
    const body = card.querySelector('.tool-body');
    card.insertBefore(card._summaryEl, body || null);
  }
  card._summaryEl.textContent = String(text || '');
  return card._summaryEl;
}

function renderToolBody(body, { args, summary = '', result = '' } = {}) {
  if (!body) return;
  body.replaceChildren();
  const sections = [];
  if (args != null && args !== '') sections.push(['Arguments', formatDetail(args)]);
  if (summary) sections.push(['Summary', String(summary)]);
  if (result) sections.push(['Result', formatDetail(result)]);

  if (sections.length === 0) {
    body.appendChild(h('div', { className: 'tool-detail-empty' }, 'No details yet'));
    return;
  }

  for (const [label, value] of sections) {
    body.appendChild(h('div', { className: 'tool-detail-label' }, label));
    body.appendChild(h('pre', { className: 'tool-detail-value' }, value));
  }
}

function formatDetail(value) {
  if (typeof value !== 'string') return JSON.stringify(value, null, 2);
  const text = value.trim();
  if (!text) return '';
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return value;
  }
}

function renderFileChange(change) {
  if (!change) return null;
  const { action, path: filePath, linesAdded, linesRemoved } = change;
  const actionClass = { edit: 'edit', create: 'create', delete: 'delete' }[action] || 'edit';
  const container = h('div', { className: 'file-changes' },
    h('div', { className: 'file-change-row' },
      h('span', { className: `fc-action ${actionClass}` }, action.toUpperCase()),
      h('span', { className: 'fc-path' }, escapeHtml(filePath)),
      linesAdded != null ? h('span', { className: 'fc-added' }, `+${linesAdded}`) : null,
      linesRemoved != null ? h('span', { className: 'fc-removed' }, `-${linesRemoved}`) : null
    )
  );
  return container;
}
