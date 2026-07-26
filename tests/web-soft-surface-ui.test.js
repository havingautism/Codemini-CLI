import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

const styles = source('codemini-web/client/style.css');
const input = source('codemini-web/client/src/components/ui/input.jsx');
const textarea = source('codemini-web/client/src/components/ui/textarea.jsx');
const select = source('codemini-web/client/src/components/ui/select.jsx');
const button = source('codemini-web/client/src/components/ui/button.jsx');
const dialog = source('codemini-web/client/src/components/ui/dialog.jsx');
const popover = source('codemini-web/client/src/components/ui/popover.jsx');
const sheet = source('codemini-web/client/src/components/ui/sheet.jsx');
const inputBar = source('codemini-web/client/src/components/InputBar.jsx');
const tabs = source('codemini-web/client/src/components/ui/tabs.jsx');
const toggleGroup = source('codemini-web/client/src/components/ui/toggle-group.jsx');
const memoryDialog = source('codemini-web/client/src/components/MemoryDialog.jsx');
const skillPanel = source('codemini-web/client/src/components/SkillPanel.jsx');
const badge = source('codemini-web/client/src/components/ui/badge.jsx');
const bubble = source('codemini-web/client/src/components/ui/bubble.jsx');
const attachment = source('codemini-web/client/src/components/ui/attachment.jsx');
const horizontalScrollStrip = source('codemini-web/client/src/components/HorizontalScrollStrip.jsx');
const messageBubble = source('codemini-web/client/src/components/MessageBubble.jsx');
const scrollArea = source('codemini-web/client/src/components/ui/scroll-area.jsx');
const streamdownRenderer = source('codemini-web/client/src/components/StreamdownRenderer.jsx');
const toolCard = source('codemini-web/client/src/components/ToolCard.jsx');
const planToolCard = source('codemini-web/client/src/components/PlanToolCard.jsx');
const webServer = source('codemini-web/server.js');

test('global themes expose a semantic soft-surface hierarchy', () => {
  for (const token of [
    '--surface-edge',
    '--surface-shadow',
    '--control-bg',
    '--control-border',
    '--control-border-hover',
    '--control-shadow',
    '--control-focus-ring',
    '--selected-bg',
    '--selected-edge',
  ]) {
    assert.match(styles, new RegExp(`${token}:`), `missing ${token}`);
  }

  assert.match(styles, /--bg-hover:\s*var\(--interactive-hover\)/);
  assert.match(styles, /--bg-active:\s*var\(--selected-bg\)/);
});

test('dark themes raise controls above the canvas and expose unified component surfaces', () => {
  assert.match(
    styles,
    /:root\[data-theme="dark"\],[\s\S]*?--control-bg:\s*color-mix\(in srgb, var\(--text-primary\) 10%, var\(--bg-secondary\)\)/,
  );
  assert.match(
    styles,
    /:root\[data-theme="dark"\],[\s\S]*?--control-border:\s*color-mix\(in srgb, var\(--text-primary\) 16%, transparent\)/,
  );
  for (const token of [
    '--badge-bg',
    '--badge-edge',
    '--message-surface',
    '--message-edge',
    '--message-shadow',
  ]) {
    assert.match(styles, new RegExp(`${token}:`), `missing ${token}`);
  }
});

test('selection primitives use a stronger state than hover', () => {
  assert.match(tabs, /data-\[state=active\]:bg-\(--selected-bg\)/);
  assert.match(
    tabs,
    /group-data-\[variant=line\]\/tabs-list:data-\[state=active\]:after:opacity-100/,
  );
  assert.match(toggleGroup, /data-\[state=on\]:bg-\(--selected-bg\)/);
  assert.match(toggleGroup, /data-\[state=on\]:shadow-\[inset_0_0_0_1px_var\(--selected-edge\)\]/);
});

test('high-frequency selectable cards distinguish selection and keyboard focus', () => {
  for (const [name, component] of [
    ['memory', memoryDialog],
    ['skill', skillPanel],
  ]) {
    assert.match(
      component,
      /bg-\(--(?:selected-bg|bg-active)\)/,
      `${name} card needs a selected surface`,
    );
    assert.match(component, /focus-visible:shadow-\[0_0_0_3px_var\(--control-focus-ring\)\]/, `${name} card needs keyboard focus`);
  }
});

test('shared form controls use soft edges, elevation, and visible states', () => {
  for (const [name, component] of [
    ['input', input],
    ['textarea', textarea],
    ['select', select],
  ]) {
    assert.match(component, /rounded-lg/, `${name} needs the shared radius`);
    assert.match(component, /border-\(--control-border\)/, `${name} needs a soft edge`);
    assert.match(component, /shadow-\[var\(--control-shadow\)\]/, `${name} needs soft elevation`);
    assert.match(component, /focus-visible:shadow-\[inset_0_0_0_1px_var\(--control-border-hover\)\]/, `${name} needs inset focus`);
    assert.match(component, /aria-invalid:/, `${name} needs an invalid state`);
  }

  assert.match(button, /outline:.*border-0.*--badge-bg.*0_1px_2px/s);
});

test('floating surfaces use quiet edges and broader soft elevation', () => {
  for (const [name, component] of [
    ['dialog', dialog],
    ['popover', popover],
    ['sheet', sheet],
  ]) {
    assert.match(component, /border-\(--surface-edge\)/, `${name} needs a quiet edge`);
    assert.match(component, /shadow-\[var\(--surface-shadow\)\]/, `${name} needs soft elevation`);
  }
  assert.match(dialog, /rounded-xl/);
  assert.match(popover, /rounded-xl/);
});

test('buttons and badges follow the unified Codex-like surface language', () => {
  assert.match(button, /rounded-lg/);
  assert.match(button, /focus-visible:shadow-\[inset_0_0_0_1px_var\(--control-border-hover\)\]/);
  assert.match(button, /secondary:.*--badge-bg.*--badge-edge/s);
  assert.match(button, /ghost:.*--bg-hover/s);
  assert.match(badge, /bg-\(--badge-bg\)/);
  assert.match(badge, /shadow-\[inset_0_0_0_1px_var\(--badge-edge\)\]/);
  assert.match(badge, /focus-visible:shadow-\[inset_0_0_0_1px_var\(--control-border-hover\)\]/);
});

test('bubbles, attachments, and modal internals share soft surfaces', () => {
  assert.match(bubble, /bg-\(--message-surface\)/);
  assert.match(bubble, /shadow-\[var\(--message-shadow\)\]/);
  assert.match(bubble, /border-\(--message-edge\)/);
  assert.match(attachment, /border-\(--message-edge\)/);
  assert.match(attachment, /bg-\(--message-surface\)/);
  assert.match(attachment, /shadow-\[var\(--message-shadow\)\]/);
  assert.match(dialog, /border-t border-\(--separator\)/);
});

test('structured messages route through unified surface and status hooks', () => {
  assert.match(styles, /\.codemini-message-surface\s*\{/);
  assert.match(styles, /\.codemini-status-chip\s*\{/);
  assert.match(messageBubble, /codemini-message-surface/);
  assert.match(messageBubble, /codemini-status-chip/);
  assert.match(toolCard, /codemini-message-surface/);
  assert.match(styles, /\.codemini-linear-card\s*\{[\s\S]*?background:\s*var\(--message-surface\)/);
});

test('user messages stay flat and the composer stays visually stable on hover', () => {
  assert.match(messageBubble, /codemini-user-bubble/);
  assert.match(styles, /\.codemini-user-bubble\s*\{\s*border:\s*0;\s*box-shadow:\s*none;\s*\}/);
  assert.doesNotMatch(styles, /\.codemini-input-shell:hover:not\(:focus-within\)/);
  assert.match(styles, /\.codemini-input-shell:focus-within/);
  assert.doesNotMatch(styles, /\.codemini-input-shell:focus-within\s*\{[^}]*0 0 0 3px/);
});

test('shared UI avoids large external focus rings', () => {
  const sharedUi = [input, textarea, select, button, badge, bubble, attachment, tabs, toggleGroup].join('\n');
  assert.doesNotMatch(sharedUi, /0_0_0_3px|ring-\[3px\]|focus-visible:ring-3/);
});

test('markdown wide content keeps a persistent horizontal scroll affordance', () => {
  assert.match(streamdownRenderer, /function PersistentMarkdownTable/);
  assert.match(streamdownRenderer, /<HorizontalScrollStrip contentClassName="block min-w-full gap-0 px-0">/);
  assert.match(streamdownRenderer, /table:\s*PersistentMarkdownTable/);
  assert.match(horizontalScrollStrip, /<ScrollArea[\s\S]*?type="auto"[\s\S]*?orientation="horizontal"/);
  assert.doesNotMatch(horizontalScrollStrip, /ResizeObserver|setPointerCapture/);
  assert.match(scrollArea, /orientation === "horizontal"[\s\S]*?"h-2 flex-col px-0\.5 py-0\.5"/);
  assert.match(
    styles,
    /\.msg-body \[data-streamdown="table-wrapper"\]>div:nth-child\(2\)\s*\{[\s\S]*?overflow-x:\s*scroll !important;/,
  );
  assert.match(
    styles,
    /\.msg-body \[data-streamdown="code-block-body"\]\s*\{[\s\S]*?overflow-x:\s*scroll !important;/,
  );
  assert.match(
    styles,
    /\.codemini-md-preview \.wmde-markdown table,[\s\S]*?\.codemini-md-editor \.wmde-markdown pre>code\s*\{[\s\S]*?overflow-x:\s*scroll !important;/,
  );
});

test('expanded sub-agents keep a compact indent and reveal adaptive task details', () => {
  assert.match(planToolCard, /function SubagentTaskDetails/);
  assert.match(planToolCard, /\{t\("planStepTask"\)\}/);
  assert.match(
    planToolCard,
    /isSubagent\s*\?\s*card\?\.arguments\?\.prompt\s*\|\|\s*planRun\?\.goal/,
  );
  assert.match(planToolCard, /ROW_CLASS,[\s\S]*?"w-full rounded-none text-left"/);
  assert.doesNotMatch(planToolCard, /rounded-t-xl/);
  assert.match(
    planToolCard,
    /rounded-md bg-\(--bg-tertiary\)[^"]*dark:bg-\(--bg-primary\)[\s\S]*?<ScrollArea[\s\S]*?type="auto"[\s\S]*?className="max-h-28 min-w-0 flex-1"[\s\S]*?viewportClassName="max-h-28/,
  );
  assert.doesNotMatch(planToolCard, /h-\[76px\]/);
  assert.match(
    planToolCard,
    /type="auto"[\s\S]*?className="mt-1 h-48 rounded-md bg-\(--bg-tertiary\) dark:bg-\(--bg-primary\)"/,
  );
  assert.match(
    planToolCard,
    /!open\s*\?\s*\([\s\S]*?min-w-0 flex-1 truncate[\s\S]*?\)\s*:\s*\([\s\S]*?flex-1/,
  );
  assert.match(
    planToolCard,
    /className="px-3 pb-3 pt-2"[\s\S]*?<SubagentTaskDetails task=\{goal\}/,
  );
  assert.doesNotMatch(
    planToolCard,
    /border-t border-\(--border-default\) px-3 pb-3 pt-2/,
  );
  assert.doesNotMatch(planToolCard, /pl-\[54px\]/);
  assert.match(planToolCard, /function SubagentDependencyDetails/);
  assert.match(planToolCard, /subagentDependencyWaiting/);
  assert.match(planToolCard, /subagentDependencyReceived/);
  assert.match(planToolCard, /subagentDependencyBlocked/);
  assert.match(planToolCard, /card\?\.arguments\?\.depends_on/);
});

test('long tool call arguments end with an ellipsis before the status indicator', () => {
  assert.match(
    toolCard,
    /msg-process-meta__detail ml-1 block min-w-0 flex-1 truncate font-mono/,
  );
  assert.match(toolCard, /LinearStatusDot className="shrink-0"/);
});

test('memory management owns the Inbox experience instead of the action palette', () => {
  assert.match(memoryDialog, /TabsTrigger value="inbox"/);
  assert.match(memoryDialog, /api\.fetchInbox/);
  assert.match(memoryDialog, /api\.discardInboxEntry/);
  assert.match(memoryDialog, /api\.runInboxDream/);
  assert.doesNotMatch(inputBar, /name:\s*"inbox"/);
  assert.match(webServer, /url\.pathname === '\/api\/memory\/inbox'/);
  assert.match(webServer, /url\.pathname\.startsWith\('\/api\/memory\/inbox\/'\)/);
  assert.match(webServer, /url\.pathname === '\/api\/memory\/inbox\/dream'/);
});
