import {
  Container,
  Input,
  Key,
  ProcessTerminal,
  Spacer,
  Text,
  TUI,
  matchesKey,
  visibleWidth as piVisibleWidth,
  wrapTextWithAnsi
} from '@mariozechner/pi-tui';

import { getPiCopy } from './copy.js';
import {
  applyPiRuntimeEvent,
  applyPiSubmitStart,
  buildInitialPiShellState,
  toggleToolDetails
} from './runtime-state.js';

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',

  fg: {
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
    redBright: '\x1b[91m',
    greenBright: '\x1b[92m',
    yellowBright: '\x1b[93m',
    blueBright: '\x1b[94m',
    magentaBright: '\x1b[95m',
    cyanBright: '\x1b[96m',
    whiteBright: '\x1b[97m'
  },
  bg: {
    black: '\x1b[40m',
    red: '\x1b[41m',
    green: '\x1b[42m',
    yellow: '\x1b[43m',
    blue: '\x1b[44m',
    magenta: '\x1b[45m',
    cyan: '\x1b[46m',
    white: '\x1b[47m',
    redBright: '\x1b[101m',
    greenBright: '\x1b[102m',
    yellowBright: '\x1b[103m',
    blueBright: '\x1b[104m',
    magentaBright: '\x1b[105m',
    cyanBright: '\x1b[106m',
    whiteBright: '\x1b[107m'
  }
};

function color(text, fgName, bgName) {
  let out = '';
  if (fgName && ANSI.fg[fgName]) out += ANSI.fg[fgName];
  if (bgName && ANSI.bg[bgName]) out += ANSI.bg[bgName];
  out += String(text);
  out += ANSI.reset;
  return out;
}

function dim(text) {
  return `${ANSI.dim}${text}${ANSI.reset}`;
}

function bold(text) {
  return `${ANSI.bold}${text}${ANSI.reset}`;
}

function stripAnsi(str) {
  return String(str || '').replace(/\x1b\[[0-9;]*m/g, '');
}

function visibleLen(str) {
  const width = typeof piVisibleWidth === 'function' ? piVisibleWidth(String(str || '')) : stripAnsi(str).length;
  return Number.isFinite(width) ? width : stripAnsi(str).length;
}

function padVisibleEnd(line, width) {
  const padding = Math.max(0, width - visibleLen(line));
  return `${line}${' '.repeat(padding)}`;
}

function wrapBoxLines(contentLines, bodyWidth) {
  const wrapped = [];
  for (const line of contentLines) {
    const text = String(line ?? '');
    const rows = wrapTextWithAnsi(text, Math.max(1, bodyWidth));
    if (rows.length === 0) {
      wrapped.push('');
      continue;
    }
    wrapped.push(...rows);
  }
  return wrapped;
}

// ── Stable ASCII box renderer ────────────────────────────────────────────────

function renderFrameBox(contentLines, borderColor = 'gray', paddingX = 1) {
  const wrappedLines = wrapBoxLines(contentLines, Math.max(1, contentLines.reduce((max, line) => {
    return Math.max(max, visibleLen(line));
  }, 0)));
  const pad = ' '.repeat(paddingX);
  const maxVis = wrappedLines.reduce((max, line) => Math.max(max, visibleLen(line)), 0);
  const innerWidth = maxVis + paddingX * 2;
  const top = `${color('+', borderColor)}${color('-'.repeat(innerWidth), borderColor)}${color('+', borderColor)}`;
  const bottom = `${color('+', borderColor)}${color('-'.repeat(innerWidth), borderColor)}${color('+', borderColor)}`;
  const side = color('|', borderColor);

  const body = wrappedLines.map((line) => {
    const paddedLine = padVisibleEnd(line, maxVis);
    return `${side}${pad}${paddedLine}${pad}${side}`;
  });

  return [top, ...body, bottom];
}

// ── Visual components (matching Ink layout) ───────────────────────────────────

function renderBanner(copy) {
  const lines = [];
  for (let i = 0; i < copy.banner.length; i++) {
    lines.push(color(copy.banner[i], copy.bannerColors[i]));
  }
  return lines;
}

function renderStatusPill(label, value, fgColor, bgColor) {
  return ` ${dim(label)} ${color(` ${value} `, fgColor || 'black', bgColor || 'cyan')} `;
}

function renderHeader(copy, runtimeSnapshot, options) {
  const lines = renderBanner(copy);
  lines.push('');
  lines.push(dim(copy.subtitle));
  lines.push('');
  const shortSession = String(runtimeSnapshot.sessionId || '').slice(-12) || '-';
  const safeMode = options.safeMode === false ? copy.footer.safeOff : copy.footer.safeOn;
  const safeColor = options.safeMode === false ? 'redBright' : 'greenBright';
  const pills = [
    renderStatusPill(copy.footer.sdk, runtimeSnapshot.sdkProvider, 'white', 'blueBright'),
    renderStatusPill(copy.footer.model, runtimeSnapshot.model, 'black', 'cyanBright'),
    renderStatusPill(copy.footer.shell, options.shellName || 'powershell', 'black', 'yellowBright'),
    renderStatusPill(copy.footer.session, shortSession, 'black', 'magentaBright'),
    renderStatusPill(copy.footer.mode, safeMode, 'black', safeColor)
  ];
  lines.push(pills.join(' '));
  return lines;
}

function renderMessage(copy, message) {
  const role = message.role || 'system';
  const label = copy.roleLabels[role] || String(role).toUpperCase();
  const style = copy.roleStyles?.[role] || { accent: 'gray', border: 'gray', badgeFg: 'white', badgeBg: 'gray' };
  const msgColor = copy.roleColors[role] || 'gray';
  const text = message.text || '';
  const toolLines = Array.isArray(message.toolLines) ? message.toolLines : [];

  const contentLines = [];
  contentLines.push(color(` ${label} `, style.badgeFg, style.badgeBg));

  if (toolLines.length > 0) {
    contentLines.push('');
    for (const line of toolLines) {
      const trimmed = String(line || '').trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('└')) {
        contentLines.push(dim(trimmed));
        continue;
      }

      if (trimmed.startsWith('🔧')) {
        contentLines.push(color(trimmed, 'cyanBright'));
        continue;
      }

      if (trimmed.startsWith('📄')) {
        contentLines.push(color(trimmed, 'greenBright'));
        continue;
      }

      if (trimmed.startsWith('⚠️') || trimmed.startsWith('⛔')) {
        contentLines.push(color(trimmed, 'yellowBright'));
        continue;
      }

      contentLines.push(color(trimmed, msgColor));
    }
  }

  if (text) {
    if (toolLines.length > 0) {
      contentLines.push('');
    }
    for (const line of text.split('\n')) {
      contentLines.push(line.trim() === '' ? '' : color(line, msgColor));
    }
  }

  const boxLines = renderFrameBox(contentLines, style.border, 1);
  const gutter = color('| ', style.accent);
  return boxLines.map((line) => `${gutter}${line}`);
}

function renderToolSummaryRow(copy, toolPanel, contextPct) {
  const expandLabel = toolPanel.expanded ? copy.toolPanel.expanded : copy.toolPanel.collapsed;
  const rows = toolPanel.expanded ? toolPanel.detailRows || [] : toolPanel.summaryRows || [];
  const leftParts = [];

  if (rows.length === 0) {
    leftParts.push(dim(`${expandLabel} (${copy.toolPanel.toggleHint})  ·  ${copy.toolPanel.scrollHint}`));
  } else {
    const items = rows.map((row) => {
      const isDone = row.includes('[done]') || row.includes('done');
      return isDone ? color('✓', 'greenBright') + ' ' + row : color('●', 'yellowBright') + ' ' + row;
    });
    leftParts.push(dim(`${expandLabel} (${copy.toolPanel.toggleHint})  ·  `) + items.join('  '));
  }

  const rightParts = [];
  const pct = typeof contextPct === 'number' ? contextPct : 0;
  const filled = Math.min(12, Math.max(0, Math.round((pct / 100) * 12)));
  const activeColor = pct < 40 ? 'greenBright' : pct < 75 ? 'yellowBright' : 'redBright';
  const bar = Array.from({ length: 12 }, (_, i) => {
    const zoneColor = i < 5 ? 'greenBright' : i < 9 ? 'yellowBright' : 'redBright';
    return color('|', i < filled ? zoneColor : 'gray');
  }).join('');

  rightParts.push(`${dim(copy.context.label)} ${color(`${Math.round(pct)}%`, activeColor)} ${bar}`);

  return `${leftParts.join('')}    ${rightParts.join('')}`;
}

function renderSpinner(copy, frame) {
  const spinner = copy.spinnerFrames[frame % copy.spinnerFrames.length];
  return color(spinner, 'cyanBright');
}

function buildInputPanelLines(copy, statusKey, spinnerFrame, toolPanel, notification) {
  const statusLabel = copy.status[statusKey] || copy.status.waiting;
  const isActive = statusKey === 'thinking' || statusKey === 'streaming' || statusKey === 'tooling' || statusKey === 'sending';

  const contentLines = [];

  // Header row
  const toolsState = toolPanel?.expanded ? 'OPEN' : 'COLLAPSED';
  const toolsColor = toolPanel?.expanded ? 'greenBright' : 'gray';
  const headerLeft = `${color(copy.commandBar.title, 'cyanBright')}  ${dim(copy.commandBar.hint)}`;
  const headerRight = color(`TOOLS ${toolsState}`, toolsColor);
  contentLines.push(`${headerLeft}  ${headerRight}`);

  // Stage tag row (only when active)
  if (isActive) {
    const spinner = renderSpinner(copy, spinnerFrame);
    const stageColor = statusKey === 'thinking' ? 'cyanBright'
      : statusKey === 'streaming' ? 'greenBright'
      : statusKey === 'tooling' ? 'magentaBright'
      : 'yellowBright';
    contentLines.push(`${spinner} ${color(statusLabel, stageColor)}`);
  }

  // Notification row (e.g. "already in progress")
  if (notification) {
    contentLines.push(dim(`  ${notification}`));
  }

  return contentLines;
}

function renderSignatureBar(copy, version) {
  const left = ' '.repeat(2);
  const center = `${dim(copy.signature.developedBy)} ${color(copy.signature.author, 'magentaBright')}`;
  const right = dim(`v${version}`);
  return `${left}${center}${' '.repeat(4)}${right}`;
}

class BoxedComposer {
  constructor(copy, innerInput, getPanelState) {
    this.copy = copy;
    this.innerInput = innerInput;
    this.getPanelState = getPanelState;
    this.focused = false;
  }

  getValue() {
    return this.innerInput.getValue();
  }

  setValue(value) {
    this.innerInput.setValue(value);
  }

  set onSubmit(handler) {
    this.innerInput.onSubmit = handler;
  }

  get onSubmit() {
    return this.innerInput.onSubmit;
  }

  set onEscape(handler) {
    this.innerInput.onEscape = handler;
  }

  get onEscape() {
    return this.innerInput.onEscape;
  }

  handleInput(data) {
    this.innerInput.focused = this.focused;
    return this.innerInput.handleInput(data);
  }

  invalidate() {
    this.innerInput.invalidate?.();
  }

  render(width) {
    const totalWidth = Math.max(24, width);
    const bodyWidth = Math.max(1, totalWidth - 4);
    const panelState = this.getPanelState();
    const contentLines = wrapBoxLines(
      buildInputPanelLines(
        this.copy,
        panelState.statusKey,
        panelState.spinnerFrame,
        panelState.toolPanel,
        panelState.notification
      ),
      bodyWidth
    );

    this.innerInput.focused = this.focused;
    const inputLines =
      typeof this.innerInput.render === 'function'
        ? this.innerInput.render(bodyWidth)
        : [padVisibleEnd(`> ${this.innerInput.getValue?.() || ''}`, bodyWidth)];
    const top = `${color('+', 'cyan')}${color('-'.repeat(totalWidth - 2), 'cyan')}${color('+', 'cyan')}`;
    const bottom = `${color('+', 'cyan')}${color('-'.repeat(totalWidth - 2), 'cyan')}${color('+', 'cyan')}`;
    const side = color('|', 'cyan');
    const rows = [];

    for (const line of contentLines) {
      rows.push(`${side} ${padVisibleEnd(line, bodyWidth)} ${side}`);
    }
    for (const line of inputLines) {
      rows.push(`${side} ${padVisibleEnd(line, bodyWidth)} ${side}`);
    }

    return [top, ...rows, bottom];
  }
}

// ── Scroll transition ─────────────────────────────────────────────────────────

const SCROLL_TRANSITION_FRAMES = 3;
const SCROLL_TRANSITION_MS = 60;

function buildTransitionPrefix(frame, total) {
  if (frame <= 0 || total <= 0) return '';
  const pct = frame / total;
  const dots = Math.max(1, Math.round(pct * 3));
  return `${'·'.repeat(dots)} `;
}

// ── Main app ──────────────────────────────────────────────────────────────────

function resolvePiTuiDeps(options = {}) {
  const injected = options.__piTui || {};
  return {
    Container: injected.Container || Container,
    Input: injected.Input || Input,
    Key: injected.Key || Key,
    ProcessTerminal: injected.ProcessTerminal || ProcessTerminal,
    Spacer: injected.Spacer || Spacer,
    Text: injected.Text || Text,
    TUI: injected.TUI || TUI,
    matchesKey: injected.matchesKey || matchesKey
  };
}

function getRuntimeSnapshot(options = {}) {
  const runtimeState =
    typeof options.runtime?.getRuntimeState === 'function' ? options.runtime.getRuntimeState() : null;
  return {
    sessionId: runtimeState?.sessionId || options.sessionId || 'new-session',
    model: runtimeState?.model || options.model || 'unknown-model',
    sdkProvider: runtimeState?.sdkProvider || options.sdkProvider || 'openai-compatible',
    mode: runtimeState?.mode || 'auto'
  };
}

function buildSubmitCompletionEvent(result) {
  const assistantMessage = result?.assistantMessage;
  const text =
    typeof result?.text === 'string'
      ? result.text
      : typeof result?.content === 'string'
        ? result.content
        : '';

  if (assistantMessage || text) {
    return { type: 'assistant:response', text, assistantMessage };
  }
  return null;
}

export async function runPiChatApp(options = {}) {
  const piTui = resolvePiTuiDeps(options);
  const copy = getPiCopy(options.language);
  const runtimeSnapshot = getRuntimeSnapshot(options);
  const version = options.version || '0.3.9';
  const terminal = new piTui.ProcessTerminal();
  const tui = new piTui.TUI(terminal);

  if (typeof tui.setClearOnShrink === 'function') {
    tui.setClearOnShrink(false);
  }

  const shellState = buildInitialPiShellState({
    runtimeState: runtimeSnapshot,
    toolDetailsExpanded: false
  });

  const root = new piTui.Container();
  const mainText = new piTui.Text('', 1, 0);
  const spacer = new piTui.Spacer(1);
  const rawInput = new piTui.Input();
  const input = new BoxedComposer(copy, rawInput, () => ({
    statusKey: state.status,
    spinnerFrame,
    toolPanel: state.toolPanel,
    notification: composerMessage
  }));

  root.addChild(mainText);
  root.addChild(spacer);
  root.addChild(input);
  tui.addChild(root);
  tui.setFocus(input);

  let closed = false;
  let resolveClose = null;
  const closePromise = new Promise((resolve) => { resolveClose = resolve; });
  let removeInputListener = () => {};
  let state = {
    status: shellState.status,
    messages: shellState.messages,
    toolPanel: shellState.toolPanel
  };
  let composerMessage = '';
  let submitInFlight = false;
  let spinnerFrame = 0;
  let spinnerTimer = null;
  let inputHistory = [];
  let historyIndex = -1;
  let draftBeforeHistory = '';
  let scrollTransitionFrame = 0;
  let scrollTransitionTimer = null;

  function composeScreen() {
    const lines = [];

    // ── Header (boxed, centered, cyan border) ──
    const headerLines = renderHeader(copy, runtimeSnapshot, options);
    lines.push(...renderFrameBox(headerLines, 'cyan', 4));
    lines.push('');

    // ── Messages (gutter + boxed per message, role-colored) ──
    const msgs = state.messages || [];
    for (const msg of msgs) {
      lines.push(...renderMessage(copy, msg));
    }

    // ── Tool summary inline row + context bar ──
    lines.push('');
    lines.push(renderToolSummaryRow(copy, state.toolPanel, 0));

    // ── Scroll transition indicator ──
    if (scrollTransitionFrame > 0) {
      const prefix = buildTransitionPrefix(scrollTransitionFrame, SCROLL_TRANSITION_FRAMES);
      lines.push(dim(`${prefix}updating...`));
    }

    // ── Input bar (boxed, cyan border) ──
    lines.push('');
    lines.push(renderSignatureBar(copy, version));

    // ── Footer hint ──
    lines.push(dim(copy.inputHint));

    return lines;
  }

  function renderShell() {
    mainText.setText(composeScreen().join('\n'));
    tui.requestRender();
  }

  function startSpinner() {
    stopSpinner();
    if (options.__noSpinner) return;
    spinnerTimer = setInterval(() => {
      spinnerFrame = (spinnerFrame + 1) % copy.spinnerFrames.length;
      renderShell();
    }, 100);
  }

  function stopSpinner() {
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
      spinnerTimer = null;
    }
    spinnerFrame = 0;
  }

  function triggerScrollTransition() {
    if (options.__noSpinner) return;
    scrollTransitionFrame = SCROLL_TRANSITION_FRAMES;
    if (scrollTransitionTimer) clearInterval(scrollTransitionTimer);
    scrollTransitionTimer = setInterval(() => {
      scrollTransitionFrame--;
      if (scrollTransitionFrame <= 0) {
        scrollTransitionFrame = 0;
        clearInterval(scrollTransitionTimer);
        scrollTransitionTimer = null;
      }
      renderShell();
    }, SCROLL_TRANSITION_MS);
  }

  function closeApp() {
    if (closed) return;
    closed = true;
    stopSpinner();
    if (scrollTransitionTimer) {
      clearInterval(scrollTransitionTimer);
      scrollTransitionTimer = null;
    }
    removeInputListener();
    tui.stop();
    resolveClose?.();
  }

  input.onEscape = closeApp;
  input.onSubmit = (value) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      if (!submitInFlight) {
        state = { ...state, status: 'waiting' };
        composerMessage = '';
        renderShell();
      }
      return;
    }

    if (submitInFlight) {
      composerMessage = 'A request is already in progress. Please wait.';
      renderShell();
      return;
    }

    submitInFlight = true;
    composerMessage = '';
    state = applyPiSubmitStart(state, trimmed);
    input.setValue('');

    if (trimmed) {
      inputHistory = [trimmed, ...inputHistory.filter((h) => h !== trimmed)].slice(0, 100);
    }
    historyIndex = -1;
    draftBeforeHistory = '';

    startSpinner();
    triggerScrollTransition();
    renderShell();

    Promise.resolve()
      .then(() => {
        let receivedEvents = false;
        if (typeof options.runtime?.submit !== 'function') {
          throw new Error('runtime.submit is required');
        }
        return Promise.resolve(options.runtime.submit(trimmed, (event) => {
          receivedEvents = true;
          composerMessage = '';
          const prevStatus = state.status;
          state = applyPiRuntimeEvent(state, event);
          if (prevStatus !== state.status) {
            triggerScrollTransition();
          }
          renderShell();
        })).then((result) => ({ result, receivedEvents }));
      })
      .then(({ result, receivedEvents }) => {
        if (!receivedEvents) {
          const completionEvent = buildSubmitCompletionEvent(result);
          if (completionEvent) {
            state = applyPiRuntimeEvent(state, completionEvent);
          } else {
            state = { ...state, status: 'waiting' };
          }
        }
      })
      .catch((error) => {
        composerMessage = '';
        state = applyPiRuntimeEvent(state, {
          type: 'assistant:response',
          text: `Runtime submit failed: ${String(error?.message || error || 'unknown error')}`
        });
      })
      .finally(() => {
        submitInFlight = false;
        composerMessage = '';
        stopSpinner();
        triggerScrollTransition();
        renderShell();
      });
  };

  removeInputListener = tui.addInputListener((data) => {
    if (piTui.matchesKey(data, piTui.Key.ctrl('c'))) {
      closeApp();
      return { consume: true };
    }

    if (piTui.matchesKey(data, piTui.Key.ctrl('t'))) {
      state = {
        ...state,
        toolPanel: toggleToolDetails(state.toolPanel)
      };
      triggerScrollTransition();
      renderShell();
      return { consume: true };
    }

    if (piTui.matchesKey(data, piTui.Key.up)) {
      if (inputHistory.length > 0) {
        if (historyIndex === -1) {
          draftBeforeHistory = input.getValue ? input.getValue() : '';
        }
        historyIndex = Math.min(historyIndex + 1, inputHistory.length - 1);
        input.setValue(inputHistory[historyIndex]);
        renderShell();
      }
      return { consume: true };
    }

    if (piTui.matchesKey(data, piTui.Key.down)) {
      if (historyIndex >= 0) {
        historyIndex--;
        const val = historyIndex === -1 ? draftBeforeHistory : inputHistory[historyIndex];
        input.setValue(val);
        renderShell();
      }
      return { consume: true };
    }

    return undefined;
  });

  renderShell();
  tui.start();

  return closePromise;
}
