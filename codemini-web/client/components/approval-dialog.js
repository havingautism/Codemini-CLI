import { h, escapeHtml } from '../utils/dom.js';
import { t } from '../i18n/index.js';

export function createApprovalDialog(overlay, { onDecision }) {
  overlay.className = 'approval-overlay hidden';

  function show(request) {
    const { id, toolName, displayName, arguments: args, details } = request;
    const variant = detectVariant(toolName, details);

    const dialog = h('div', { className: 'approval-dialog' });
    dialog.appendChild(buildHeader(variant));
    dialog.appendChild(buildBody(variant, args, details));
    dialog.appendChild(buildFooter(id, onDecision));

    overlay.innerHTML = '';
    overlay.appendChild(dialog);
    overlay.classList.remove('hidden');
  }

  function hide() {
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
  }

  return { show, hide };
}

function detectVariant(toolName, details) {
  if (toolName === 'delete') return 'delete';
  if (toolName === 'run') return 'run';
  if (details?.planApproval) return 'plan';
  if (details?.reflectApproval) return 'reflect';
  return 'generic';
}

function buildHeader(variant) {
  const titles = {
    delete: t('deleteApproval'),
    run: t('runApproval'),
    plan: t('planApproval'),
    reflect: t('reflectApproval'),
    generic: t('approveTitle')
  };
  return h('div', { className: 'approval-header' }, titles[variant] || t('approveTitle'));
}

function buildBody(variant, args, details) {
  const body = h('div', { className: 'approval-body' });

  if (variant === 'delete') {
    const parsed = parseArgs(args);
    body.appendChild(detailRow('File', parsed.path || parsed.name || '-'));
    body.appendChild(detailRow('Type', parsed.type || 'file'));
  } else if (variant === 'run') {
    const parsed = parseArgs(args);
    body.appendChild(detailRow('Command', parsed.command || '-'));
    if (details?.risk) body.appendChild(detailRow('Risk', details.risk));
    if (details?.description) body.appendChild(detailRow('Info', details.description));
  } else if (variant === 'plan') {
    if (details?.title) body.appendChild(h('p', {}, escapeHtml(details.title)));
    if (details?.steps) {
      const list = h('ol', {});
      for (const step of details.steps) {
        list.appendChild(h('li', { style: { margin: '4px 0' } }, `${step.role || ''}: ${escapeHtml(step.title || '')}`));
      }
      body.appendChild(list);
    }
  } else if (variant === 'reflect') {
    if (details?.scope) body.appendChild(detailRow('Scope', details.scope));
    if (details?.skillName) body.appendChild(detailRow('Skill', details.skillName));
    if (details?.targetPath) body.appendChild(detailRow('Path', details.targetPath));
  } else {
    const parsed = parseArgs(args);
    body.appendChild(detailRow('Tool', parsed._raw || '-'));
  }

  return body;
}

function buildFooter(id, onDecision) {
  const footer = h('div', { className: 'approval-footer' });
  const denyBtn = h('button', { className: 'btn btn-deny', onClick: () => onDecision(id, false) }, t('deny'));
  const approveBtn = h('button', { className: 'btn btn-approve', onClick: () => onDecision(id, true) }, t('approve'));
  footer.append(denyBtn, approveBtn);
  return footer;
}

function detailRow(label, value) {
  return h('div', { className: 'detail-row' },
    h('span', { className: 'detail-label' }, label),
    h('span', { className: 'detail-value' }, escapeHtml(String(value)))
  );
}

function parseArgs(args) {
  if (!args) return {};
  try {
    const obj = typeof args === 'string' ? JSON.parse(args) : args;
    return { ...obj, _raw: JSON.stringify(obj) };
  } catch {
    return { _raw: String(args) };
  }
}
