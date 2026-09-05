import { SelectList, matchesKey, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';

import { bold, color, sealAnsi, selectTheme, TEXT_FG } from '../theme.js';
import { oneLine } from './messages.js';
import {
  buildTowerProgressItems,
  formatTowerProgressLine,
  shouldShowTowerProgressDock,
} from '../../core/tower-progress.js';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const LIVE_STATES = new Set(['thinking', 'generating', 'tool', 'sending', 'stopping']);

function fill(text, width, background = color.surfaceBg, padding = 1) {
  const safe = truncateToWidth(sealAnsi(text), Math.max(1, width - padding * 2), '…');
  return background(`${TEXT_FG}${' '.repeat(padding)}${safe}${' '.repeat(Math.max(0, width - visibleWidth(safe) - padding * 2))}${' '.repeat(padding)}`);
}

function joinSides(left, right, width) {
  const safeRight = truncateToWidth(right, Math.max(0, width - 2), '…');
  const safeLeft = truncateToWidth(left, Math.max(0, width - visibleWidth(safeRight) - 2), '…');
  return `${safeLeft}${' '.repeat(Math.max(2, width - visibleWidth(safeLeft) - visibleWidth(safeRight)))}${safeRight}`;
}

function modalFrame(lines, width) {
  const edge = (text) => color.overlayBg(color.border(text));
  return [
    edge(`╭${'─'.repeat(Math.max(0, width - 2))}╮`),
    ...lines.map((line) => `${edge('│')}${line}${edge('│')}`),
    edge(`╰${'─'.repeat(Math.max(0, width - 2))}╯`)
  ];
}

function executionMode(state) {
  return ['plan', 'code', 'coding', 'spec'].includes(String(state?.mode || '')) ? 'coding' : 'daily';
}

function contextMeter(pct, size = 8) {
  const bounded = Math.max(0, Math.min(100, Number(pct) || 0));
  const used = Math.round((bounded / 100) * size);
  const style = bounded >= 80 ? color.error : bounded >= 55 ? color.warning : color.success;
  return `${style('━'.repeat(used))}${color.dim('─'.repeat(size - used))}`;
}

export class TopBar {
  constructor({ version }) { this.version = version; }

  invalidate() {}

  render(width) {
    const logo = `${color.accent('◆')} ${bold(color.text('CODEMINI'))}`;
    const version = this.version ? color.dim(`v${this.version}`) : '';
    return [fill(joinSides(logo, version, width - 2), width, color.surfaceRaisedBg)];
  }
}

export class ActivityBar {
  constructor({ tui, copy }) {
    this.tui = tui;
    this.copy = copy;
    this.kind = 'idle';
    this.message = copy.ready;
    this.queueCount = 0;
    this.frame = 0;
    this.timer = null;
  }

  invalidate() {}

  set({ kind = 'idle', message = this.copy.ready, queueCount = 0 }) {
    this.kind = kind;
    this.message = message;
    this.queueCount = queueCount;
    if (LIVE_STATES.has(kind)) this.start();
    else this.stop();
    this.tui.requestRender();
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % SPINNER.length;
      this.tui.requestRender();
    }, 90);
    this.timer.unref?.();
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  dispose() { this.stop(); }

  render(width) {
    const live = LIVE_STATES.has(this.kind);
    const dot = live ? color.purple(SPINNER[this.frame]) : this.kind === 'error' ? color.error('●') : color.dim('●');
    const queue = this.queueCount ? color.warning(`  ${this.copy.queued(this.queueCount)}`) : '';
    const left = `${dot} ${color.text(this.message)}${queue}`;
    const right = width >= 76 ? color.dim(this.copy.activityKeys) : '';
    return [fill(joinSides(left, right, width - 2), width, color.surfaceRaisedBg)];
  }
}

export class QueuePanel {
  constructor(copy) {
    this.copy = copy;
    this.items = [];
  }

  invalidate() {}
  setItems(items) { this.items = [...items]; }

  render(width) {
    if (!this.items.length) return [];
    const previews = this.items.slice(0, 2).map((item) => oneLine(item, 36)).join('  ·  ');
    const more = this.items.length > 2 ? `  +${this.items.length - 2}` : '';
    const hint = this.copy.queueJump ? `  ${color.dim(this.copy.queueJump)}` : '';
    return [fill(`${color.dim(this.copy.queueTitle)}  ${color.muted(previews)}${color.dim(more)}${hint}`, width, color.surfaceBg)];
  }
}

export class TowerProgressPanel {
  constructor({ runtime, copy }) {
    this.runtime = runtime;
    this.copy = copy;
  }

  invalidate() {}

  render(width) {
    const state = this.runtime.getRuntimeState?.() || {};
    if (!state.towerActive) return [];
    const workers = Array.isArray(state.towerWorkers) ? state.towerWorkers : [];
    const inFlightIds = Array.isArray(state.towerInFlightIds) ? state.towerInFlightIds : [];
    if (!shouldShowTowerProgressDock({ towerActive: true, workers, inFlightIds })) return [];
    const items = buildTowerProgressItems({ workers, inFlightIds });
    const labels = {
      running: this.copy.towerPhaseRunning,
      queued: this.copy.towerPhaseQueued,
      reviewing: this.copy.towerPhaseReviewing,
      awaiting_review: this.copy.towerPhaseAwaitingReview,
      ready: this.copy.towerPhaseReady,
      dirty: this.copy.towerPhaseDirty,
      merged: this.copy.towerPhaseMerged,
      failed: this.copy.towerPhaseFailed,
      survey_done: this.copy.towerPhaseSurveyDone,
      idle: this.copy.towerPhaseIdle,
    };
    const line = formatTowerProgressLine(items, labels);
    if (!line) return [];
    return [fill(`${color.warning(this.copy.towerProgress)}  ${color.muted(line)}`, width, color.surfaceBg)];
  }
}

export class Footer {
  constructor({ runtime, model, sessionId, safeMode }) {
    this.runtime = runtime;
    this.model = model;
    this.sessionId = sessionId;
    this.safeMode = safeMode;
  }

  invalidate() {}

  render(width) {
    const state = this.runtime.getRuntimeState?.() || {};
    const mode = executionMode(state);
    const approval = String(state.approvalMode || (this.safeMode ? 'auto' : 'full_access'));
    const sandbox = String(state.sandboxMode || 'workspace-write');
    const shell = String(state.shell || 'bash').toUpperCase();
    const modeTag = state.towerActive
      ? `${color.warning('◆')} ${bold(color.warning('CREW'))}`
      : mode === 'coding'
        ? `${color.accent('◆')} ${bold(color.accent('CODE'))}`
        : `${color.cyan('◆')} ${bold(color.cyan('DAILY'))}`;
    const accessTag = approval === 'full_access'
      ? `${color.error('●')} ${color.error('OPEN')}`
      : approval === 'review'
        ? `${color.warning('●')} ${color.warning('REVIEW')}`
        : `${color.success('●')} ${color.success('AUTO')}`;
    const sandboxTag = sandbox === 'danger-full-access'
      ? `${color.error('◇')} ${color.error('UNSANDBOXED')}`
      : sandbox === 'read-only'
        ? `${color.cyan('◇')} ${color.cyan('READ ONLY')}`
        : `${color.purple('◇')} ${color.purple('WORKSPACE')}`;
    const divider = color.dim('  │  ');
    const modelName = String(state.model || this.model || '-');
    const session = String(this.sessionId || state.sessionId || '').slice(-8);
    const pct = Number.isFinite(state.contextUsagePct) ? Math.round(state.contextUsagePct) : 0;
    const cwd = String(state.workspaceRoot || process.cwd());
    const tokenText = state.currentContextTokens && state.maxContextTokens
      ? `${Math.round(state.currentContextTokens / 1000)}k/${Math.round(state.maxContextTokens / 1000)}k`
      : `${pct}%`;
    const right = `${color.dim('CTX')} ${contextMeter(pct)} ${color.muted(tokenText)}`;
    const environment = [modeTag, accessTag, ...(width >= 72 ? [sandboxTag] : []), ...(width >= 96 ? [`${color.dim('›')} ${color.muted(shell)}`] : [])].join(divider);
    const identity = `${color.purple('◆')} ${color.text(modelName)}${width >= 68 && session ? `${divider}${color.dim('#')} ${color.muted(session)}` : ''}`;
    const location = `${color.dim('⌂')} ${color.muted(cwd)}`;
    return [
      fill(joinSides(environment, identity, width - 2), width, color.surfaceRaisedBg),
      fill(joinSides(location, right, width - 2), width, color.surfaceRaisedBg)
    ];
  }
}

export class ApprovalDialog {
  constructor(request, onDecision, copy) {
    this.request = request;
    this.copy = copy;
    this.list = new SelectList([
      { value: 'approve', label: copy.approve, description: copy.approveDescription },
      { value: 'reject', label: copy.reject, description: copy.rejectDescription }
    ], 2, selectTheme);
    this.list.onSelect = (item) => onDecision(item.value === 'approve');
    this.list.onCancel = () => onDecision(false);
  }

  invalidate() { this.list.invalidate(); }
  handleInput(data) { this.list.handleInput(data); }

  render(width) {
    const innerWidth = Math.max(1, width - 2);
    const title = bold(color.warning(this.copy.approvalTitle));
    const tool = this.request?.displayName || this.request?.name || this.request?.toolName || '';
    const detail = oneLine(
      this.request?.command || this.request?.path || this.request?.summary || this.request?.description,
      Math.max(20, innerWidth - 4)
    );
    const question = detail || this.copy.approvalQuestion;
    return modalFrame([
      fill(`${title}${tool ? `  ${color.muted(tool)}` : ''}`, innerWidth, color.overlayBg),
      fill(color.text(question), innerWidth, color.overlayBg),
      color.overlayBg(' '.repeat(innerWidth)),
      ...this.list.render(innerWidth).map((line) => fill(line, innerWidth, color.overlayBg, 0))
    ], width);
  }
}

export class SessionPicker {
  constructor(sessions, { copy, currentSessionId, onSelect, onCancel }) {
    this.copy = copy;
    this.sessions = sessions;
    this.currentSessionId = currentSessionId;
    this.onSelect = onSelect;
    this.onCancel = onCancel;
    this.group = null;
    this.groups = this.createGroups();
    this.showGroups();
  }

  createGroups() {
    const groups = [];
    const general = this.sessions.filter((session) => session.isGeneral === true);
    if (general.length) groups.push({ key: 'general', label: this.copy.generalChat, icon: '💬', sessions: general });
    const projects = new Map();
    for (const session of this.sessions.filter((entry) => entry.isGeneral !== true)) {
      const key = String(session.projectKey || session.projectDir || 'unknown');
      if (!projects.has(key)) projects.set(key, []);
      projects.get(key).push(session);
    }
    for (const [key, sessions] of projects) {
      const label = key === 'unknown'
        ? this.copy.unknownProject
        : key.split(/[\\/]/).filter(Boolean).at(-1) || key;
      groups.push({ key: `project:${key}`, label, icon: '▣', path: key, sessions });
    }
    return groups;
  }

  showGroups() {
    this.group = null;
    const items = this.groups.map((group) => ({
      value: group.key,
      label: `${group.sessions.some((session) => session.id === this.currentSessionId) ? '● ' : ''}${group.icon} ${group.label}`,
      description: group.path || this.copy.sessionCount(group.sessions.length)
    }));
    this.list = items.length ? new SelectList(items, Math.min(10, items.length), selectTheme) : null;
    if (this.list) {
      this.list.onSelect = (item) => this.showSessions(this.groups.find((group) => group.key === item.value));
      this.list.onCancel = this.onCancel;
    }
  }

  showSessions(group) {
    if (!group) return;
    this.group = group;
    const items = group.sessions.map((session) => ({
      value: session.id,
      label: `${session.id === this.currentSessionId ? '● ' : ''}${session.title || session.id}`,
      description: `${session.messageCount || 0} ${this.copy.messages}${session.preview ? ` · ${oneLine(session.preview, 44)}` : ''}`
    }));
    this.list = items.length ? new SelectList(items, Math.min(10, items.length), selectTheme) : null;
    if (this.list) {
      this.list.onSelect = (item) => this.onSelect(item.value);
      this.list.onCancel = () => this.back();
    }
  }

  back() {
    if (!this.group) return false;
    this.showGroups();
    return true;
  }

  invalidate() { this.list?.invalidate(); }
  handleInput(data) {
    if (this.list) this.list.handleInput(data);
    else if (matchesKey(data, 'escape') || matchesKey(data, 'return') || matchesKey(data, 'ctrl+g')) this.onCancel();
  }

  render(width) {
    const innerWidth = Math.max(1, width - 2);
    return modalFrame([
      fill(bold(color.accent(this.group ? `${this.copy.sessionHistory}  ›  ${this.group.label}` : this.copy.sessionHistory)), innerWidth, color.overlayBg),
      fill(color.dim(this.group ? this.copy.historyBack : this.copy.chooseSessionGroup), innerWidth, color.overlayBg),
      ...(this.list
        ? this.list.render(innerWidth).map((line) => fill(line, innerWidth, color.overlayBg, 0))
        : [fill(color.muted(this.copy.noSessions), innerWidth, color.overlayBg), fill(color.dim(this.copy.helpClose), innerWidth, color.overlayBg)])
    ], width);
  }
}

export class SettingsDialog {
  constructor({ copy, values, souls = [], onChange, onClose }) {
    this.copy = copy;
    this.index = 0;
    this.values = { ...values };
    this.souls = souls;
    this.onChange = onChange;
    this.onClose = onClose;
  }

  invalidate() {}

  get fields() {
    const category = this.values.mode === 'daily' ? 'daily' : 'coding';
    const souls = this.souls.filter((soul) => soul.category === category).map((soul) => soul.name);
    return [
      { key: 'mode', label: `🧭 ${this.copy.settingMode}`, options: ['coding', 'daily', 'crew'] },
      { key: 'reasoning', label: `🧠 ${this.copy.settingReasoning}`, options: ['off', 'auto', 'low', 'medium', 'high'] },
      { key: 'approval', label: `✅ ${this.copy.settingApproval}`, options: ['review', 'auto', 'full_access'] },
      { key: 'sandbox', label: `🔒 ${this.copy.settingSandbox}`, options: ['read-only', 'workspace-write', 'danger-full-access'] },
      { key: 'soul', label: `🎭 ${this.copy.settingSoul}`, options: souls.length ? souls : [this.values.soul || '-'] }
    ];
  }

  change(direction = 1) {
    const field = this.fields[this.index];
    const current = field.options.indexOf(this.values[field.key]);
    const next = field.options[(Math.max(0, current) + direction + field.options.length) % field.options.length];
    this.values[field.key] = next;
    if (field.key === 'mode') {
      const category = next === 'daily' ? 'daily' : 'coding';
      this.values.soul = this.souls.find((soul) => soul.category === category && soul.active)?.name
        || this.souls.find((soul) => soul.category === category)?.name
        || '-';
    }
    void Promise.resolve(this.onChange(field.key, next)).catch(() => {});
  }

  handleInput(data) {
    if (matchesKey(data, 'escape') || matchesKey(data, 'ctrl+g')) return this.onClose();
    const count = this.fields.length;
    if (matchesKey(data, 'up') || matchesKey(data, 'shift+tab')) this.index = (this.index + count - 1) % count;
    else if (matchesKey(data, 'down') || matchesKey(data, 'tab')) this.index = (this.index + 1) % count;
    else if (matchesKey(data, 'left')) this.change(-1);
    else if (matchesKey(data, 'right') || matchesKey(data, 'return') || matchesKey(data, 'space')) this.change(1);
  }

  render(width) {
    const innerWidth = Math.max(1, width - 2);
    const rows = this.fields.map((field) => joinSides(field.label, this.copy.settingValues[this.values[field.key]] || this.values[field.key], innerWidth - 4));
    return modalFrame([
      fill(bold(color.accent(this.copy.startupSettings)), innerWidth, color.overlayBg),
      color.overlayBg(' '.repeat(innerWidth)),
      ...rows.map((text, index) => fill(index === this.index ? color.selectionBg(bold(color.text(`› ${text}`))) : `  ${color.muted(text)}`, innerWidth, color.overlayBg)),
      color.overlayBg(' '.repeat(innerWidth)),
      fill(color.dim(this.copy.settingsClose), innerWidth, color.overlayBg)
    ], width);
  }
}

export class HelpDialog {
  constructor({ copy, onClose }) {
    this.copy = copy;
    this.onClose = onClose;
  }

  invalidate() {}

  handleInput(data) {
    if (matchesKey(data, 'escape') || matchesKey(data, 'return') || matchesKey(data, 'ctrl+g')) this.onClose();
  }

  render(width) {
    const innerWidth = Math.max(1, width - 2);
    const rows = this.copy.shortcutRows;
    const lines = [fill(bold(color.accent(this.copy.helpTitle)), innerWidth, color.overlayBg)];
    for (const [key, description] of rows) {
      lines.push(fill(joinSides(color.text(key), color.muted(description), innerWidth - 2), innerWidth, color.overlayBg));
    }
    lines.push(fill(color.dim(this.copy.helpClose), innerWidth, color.overlayBg));
    return modalFrame(lines, width);
  }
}
