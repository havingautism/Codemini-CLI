import { matchesKey, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';

import { bold, color } from '../theme.js';

const LOGO = [
  ' ██████╗ ██████╗ ██████╗ ███████╗███╗   ███╗██╗███╗   ██╗██╗',
  '██╔════╝██╔═══██╗██╔══██╗██╔════╝████╗ ████║██║████╗  ██║██║',
  '██║     ██║   ██║██║  ██║█████╗  ██╔████╔██║██║██╔██╗ ██║██║',
  '██║     ██║   ██║██║  ██║██╔══╝  ██║╚██╔╝██║██║██║╚██╗██║██║',
  '╚██████╗╚██████╔╝██████╔╝███████╗██║ ╚═╝ ██║██║██║ ╚████║██║',
  ' ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═╝'
];

function center(text, width) {
  const safe = truncateToWidth(text, width, '…');
  return `${' '.repeat(Math.max(0, Math.floor((width - visibleWidth(safe)) / 2)))}${safe}`;
}

function row(action, width, selected = false) {
  const contentWidth = Math.max(1, width - 2);
  const left = `${selected ? '›' : ' '}  ${action.icon}  ${action.label}`;
  const right = action.description;
  const gap = Math.max(2, contentWidth - visibleWidth(left) - visibleWidth(right));
  const safe = truncateToWidth(`${left}${' '.repeat(gap)}${right}`, contentWidth, '…');
  const line = ` ${safe}${' '.repeat(Math.max(0, contentWidth - visibleWidth(safe)))} `;
  return selected ? color.selectionBg(bold(color.text(line))) : color.surfaceBg(color.muted(line));
}

function badge(icon, value, style = color.text) {
  return color.surfaceRaisedBg(` ${icon} ${style(String(value || '-'))} `);
}

function codingMode(mode) {
  return ['plan', 'code', 'coding', 'spec'].includes(String(mode || ''));
}

export class ModeHome {
  constructor({ state = {}, model = '', version = '', safeMode = true, copy, getHeight, onAction }) {
    this.index = 0;
    this.mode = codingMode(state.mode) ? 'coding' : 'daily';
    this.state = state;
    this.model = model;
    this.version = version;
    this.safeMode = safeMode;
    this.copy = copy;
    this.getHeight = getHeight;
    this.onAction = onAction;
    this.loading = false;
  }

  get actions() {
    const current = Number(this.state.messageCount || 0) > 0
      ? [{ value: 'continue', icon: color.success('▶'), label: this.copy.continueConversation, description: this.state.sessionTitle || this.copy.continueDescription }]
      : [];
    return [
      { value: 'new', icon: color.accent('＋'), label: this.copy.newConversation, description: this.copy.newConversationDescription },
      ...current,
      { value: 'sessions', icon: color.purple('◷'), label: this.copy.sessionHistory, description: this.copy.historyDescription },
      { value: 'settings', icon: color.warning('⚙️'), label: this.copy.startupSettings, description: this.mode === 'coding' ? this.copy.modeCoding : this.copy.modeDaily },
      { value: 'help', icon: color.cyan('?'), label: this.copy.helpTitle, description: this.copy.shortcutsDescription }
    ];
  }

  invalidate() {}

  syncSession(state = {}) {
    this.state = { ...this.state, ...state };
    this.index = Math.min(this.index, this.actions.length - 1);
  }

  handleInput(data) {
    if (this.loading) return;
    const actions = this.actions;
    if (matchesKey(data, 'up') || matchesKey(data, 'shift+tab')) {
      this.index = (this.index + actions.length - 1) % actions.length;
    } else if (matchesKey(data, 'down') || matchesKey(data, 'tab')) {
      this.index = (this.index + 1) % actions.length;
    } else if (matchesKey(data, 'return') || matchesKey(data, 'space')) {
      const action = actions[this.index]?.value;
      if (action === 'new' || action === 'continue') this.loading = true;
      this.onAction(action);
    }
  }

  render(width) {
    const height = this.getHeight?.() || 24;
    const panelWidth = Math.min(76, Math.max(36, width - 4));
    const logo = width >= 68 && height >= 20 ? LOGO : ['◆ CODEMINI ◆'];
    const access = String(this.state.approvalMode || (this.safeMode ? 'auto' : 'full_access'));
    const accessStyle = access === 'full_access' ? color.error : access === 'review' ? color.warning : color.success;
    const meta = [
      badge(color.accent('◆'), this.state.model || this.model || '-'),
      badge(accessStyle('●'), access.toUpperCase(), accessStyle),
      badge(color.purple('◇'), this.state.sandboxMode || '-'),
      badge(color.cyan('›'), this.state.shell || '-')
    ].join('  ');
    const workspace = String(this.state.workspaceRoot || process.cwd());
    const lines = ['', ...logo.map((line, index) => center((index < 2 ? color.accent : color.purple)(line), width))];
    lines.push(center(color.dim(`v${this.version}`), width), '', center(color.muted(this.copy.startCenter), width), '');
    for (let index = 0; index < this.actions.length; index += 1) {
      lines.push(center(row(this.actions[index], panelWidth, index === this.index), width));
    }
    lines.push('', center(truncateToWidth(meta, panelWidth, '…'), width));
    if (height >= 18) lines.push(center(`${color.dim('⌂')} ${color.muted(truncateToWidth(workspace, panelWidth - 2, '…'))}`, width));
    lines.push('', center(color.dim(this.loading ? this.copy.entering : this.copy.homeKeys), width));
    return [...Array(Math.max(0, Math.floor((height - lines.length) / 2))).fill(''), ...lines];
  }
}
