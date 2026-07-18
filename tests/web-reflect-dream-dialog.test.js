import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

const app = source('codemini-web/client/src/App.jsx');
const context = source('codemini-web/client/src/context/app-context.jsx');
const inputBar = source('codemini-web/client/src/components/InputBar.jsx');
const reflectDialog = source('codemini-web/client/src/components/ReflectApprovalDialog.jsx');
const chatRuntime = source('src/core/chat-runtime.js');
const dreamDialog = source('codemini-web/client/src/components/DreamDialog.jsx');
const activities = source('codemini-web/client/src/components/RuntimeActivityStrip.jsx');
const messages = source('codemini-web/client/src/components/MessageBubble.jsx');

test('reflect and dream actions open dedicated result dialogs', () => {
  assert.match(app, /<ReflectApprovalDialog/);
  assert.match(app, /<DreamDialog/);
  assert.match(context, /reflectDialogOpen:\s*true/);
  assert.match(context, /dreamDialogStatus:\s*"generating"/);
  assert.match(reflectDialog, /reflectStepAnalyze/);
  assert.match(reflectDialog, /reflectNoCandidateTitle/);
  assert.match(dreamDialog, /dreamStepScreen/);
  assert.match(dreamDialog, /dreamCompleteTitle/);
});

test('reflect output selects global/coding/daily index context and persists it on approval', () => {
  assert.match(reflectDialog, /SelectItem value="global"/);
  assert.match(reflectDialog, /SelectItem value="coding"/);
  assert.match(reflectDialog, /SelectItem value="daily"/);
  assert.match(reflectDialog, /onUpdate\?\.\(\{ \.\.\.draft, context \}\)/);
  assert.match(chatRuntime, /nextConfig\.skills\.contexts\[written\.draft\.name\]/);
  assert.match(chatRuntime, /reflectContext === 'global'[\s\S]*?\['coding', 'daily'\]/);
});

test('action palette closes before an action starts', () => {
  const closeIndex = inputBar.indexOf('setPaletteOpen(false)', inputBar.indexOf('handleCommandSelect'));
  const prepareIndex = inputBar.indexOf('onActionStart?.(item.name)', closeIndex);
  const paintIndex = inputBar.indexOf('requestAnimationFrame(resolve)', prepareIndex);
  const runIndex = inputBar.indexOf('await runComposerAction(item.name, onAction)', closeIndex);
  assert.ok(closeIndex >= 0, 'palette should close when an action is selected');
  assert.ok(prepareIndex > closeIndex, 'dialog should open after the palette closes');
  assert.ok(paintIndex > prepareIndex, 'dialog should receive a paint before the request starts');
  assert.ok(runIndex > paintIndex, 'the action should start after the dialog is painted');
});

test('reflect and dream status stay out of badges and conversation messages', () => {
  assert.match(activities, /activity\.key !== "reflect" && activity\.key !== "dream"/);
  assert.match(context, /isReflectSystemSummaryText\(result\.text\)/);
  assert.match(context, /isDreamSystemSummaryText\(result\.text\)/);
  assert.match(messages, /if \(dreamNotice\) return null/);
  assert.match(messages, /Reflect found no reusable skill candidate/);
});

test('runtime state refresh cannot dismiss an active result dialog', () => {
  const runtimeStateCase = context.match(
    /case "runtime:state":[\s\S]*?case "codewiki:generate_progress":/,
  )?.[0] || '';
  assert.ok(runtimeStateCase, 'runtime:state handler should exist');
  assert.doesNotMatch(runtimeStateCase, /reflectDialogOpen/);
  assert.doesNotMatch(runtimeStateCase, /dreamDialogOpen/);
});

test('empty conversations disable workflow-dependent actions', () => {
  assert.match(inputBar, /name:\s*"reflect",[\s\S]*?requiresConversation:\s*true/);
  assert.match(inputBar, /name:\s*"compact",[\s\S]*?requiresConversation:\s*true/);
  assert.match(inputBar, /disabled:\s*command\.requiresConversation && !hasConversation/);
  assert.match(inputBar, /disabled=\{item\.disabled\}/);
});

test('discarding a reflect draft waits for completion and clears modal state', () => {
  const approveReflect = context.match(
    /approveReflect:\s*async[\s\S]*?updatePendingReflect:\s*async/,
  )?.[0] || '';
  assert.match(approveReflect, /waitForAcceptedOperation/);
  assert.match(approveReflect, /pendingReflectApproval:\s*null/);
  assert.match(approveReflect, /reflectDialogOpen:\s*false/);
  assert.match(approveReflect, /pendingReflectApproval:\s*draft/);
  assert.match(approveReflect, /reflectDialogError:\s*err\.message/);
});
