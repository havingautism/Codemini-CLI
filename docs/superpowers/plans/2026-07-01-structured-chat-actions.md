# Structured Chat Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace interactive slash/directive commands in the WebUI and TUI with structured actions and explicit per-message skill selection.

**Architecture:** Add a runtime action boundary that validates action names, payloads, and pending-state constraints before invoking existing behavior. Normal messages carry text, attachments, and selected skill names as structured fields; WebUI and TUI become adapters over the same message/action contracts.

**Tech Stack:** Node.js 22+, ES modules, React 19, Ink 7, Vite, Node test runner.

## Global Constraints

- `/command`, `command:[...]`, and `skill:[...]` are no longer interactive chat protocols.
- A slash in chat input is ordinary text.
- WebUI opens the Actions/Skills palette from a leftmost `+` toolbar button.
- TUI opens the equivalent selector with `Ctrl+K`.
- Review states accept only valid selectable actions; revision feedback uses a dedicated input state.
- Selected skills apply only to the current message and do not change installation or enablement.
- Preserve Windows and PowerShell compatibility.
- Do not edit generated files under `codemini-web/dist`.
- Non-interactive `codemini run` remains supported through its own argument parsing.

---

## File Map

- Create `src/core/chat-action-dispatcher.js`: action names, payload validation, and pending-state validation.
- Create `src/core/chat-message.js`: normalize structured chat submissions and compose selected skill instructions.
- Modify `src/core/chat-runtime.js`: expose `submitMessage()` and `dispatchAction()` and route existing behavior through them.
- Modify `src/core/input-parser.js`: parse only empty, shell, and ordinary chat input.
- Modify `src/commands/run.js`: parse non-interactive skill/action options without relying on chat input syntax.
- Modify `src/commands/chat.js`: remove plain-mode directive guidance and use explicit runtime calls where controls are available.
- Modify `src/tui/chat-app.js`: add the `Ctrl+K` selector, structured message submission, and selectable review controls.
- Create `src/tui/action-selector.js`: pure selector state transitions used by the Ink UI and unit tests.
- Modify `codemini-web/server.js`: accept structured message/action payloads and remove command completion behavior.
- Modify `codemini-web/client/src/hooks/use-api.js`: add structured message/action API calls.
- Modify `codemini-web/client/src/context/app-context.jsx`: stop synthesizing command strings.
- Modify `codemini-web/client/src/components/InputBar.jsx`: add `+`, remove slash state, and emit structured submissions.
- Modify `codemini-web/client/src/components/SpecApprovalDialog.jsx`: emit named spec actions.
- Modify `codemini-web/client/src/components/ReflectApprovalDialog.jsx`: emit named reflect actions and feedback.
- Modify `codemini-web/client/src/components/ApprovalDialog.jsx`: emit structured approve/reject actions.
- Create `codemini-web/client/src/lib/chat-action-names.js`: browser-safe action-name constants matching the server contract.
- Modify `codemini-web/client/src/lib/user-skill-prompt.js`: retain display helpers only; remove directive parsing/building.
- Modify affected copy in `src/tui/chat-app.js` and `codemini-web/client/src/i18n` sources discovered during implementation.
- Replace legacy directive tests and add focused core, TUI, server, and WebUI behavior tests.

---

### Task 1: Define Structured Message and Action Contracts

**Files:**
- Create: `src/core/chat-action-dispatcher.js`
- Create: `src/core/chat-message.js`
- Create: `tests/chat-action-dispatcher.test.js`
- Create: `tests/chat-message.test.js`
- Modify: `src/core/input-parser.js`
- Modify: `tests/skill-command.test.js`
- Modify: `tests/command-directive-display.test.js`

**Interfaces:**
- Produces: `normalizeChatSubmission(input) -> { text, skillNames, attachmentIds, dismissedAlwaysSkills }`
- Produces: `composeSelectedSkills(commands, submission, options) -> { text, modelText, skillNames } | { error }`
- Produces: `validateChatAction(action, runtimeState) -> { name, payload } | throws ChatActionError`
- Produces: `CHAT_ACTIONS` stable action-name constants.

- [ ] **Step 1: Write failing parser and message-contract tests**

```js
test('slash and legacy directives are ordinary chat text', () => {
  for (const text of ['/yes', '/brainstorming task', 'command:[compact]', 'skill:[brainstorming] task']) {
    assert.deepEqual(parseInput(text), { type: 'chat', text });
  }
});

test('normalizes and deduplicates structured skills', () => {
  assert.deepEqual(normalizeChatSubmission({
    text: 'review this',
    skillNames: ['brainstorming', 'brainstorming', 'writing-plans'],
    attachmentIds: ['a', 'a'],
    dismissedAlwaysSkills: ['test-driven-development']
  }), {
    text: 'review this',
    skillNames: ['brainstorming', 'writing-plans'],
    attachmentIds: ['a'],
    dismissedAlwaysSkills: ['test-driven-development']
  });
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```powershell
node --test tests/chat-message.test.js tests/skill-command.test.js tests/command-directive-display.test.js
```

Expected: FAIL because `chat-message.js` does not exist and legacy directives still parse specially.

- [ ] **Step 3: Implement message normalization and ordinary slash parsing**

```js
export function normalizeChatSubmission(input = {}) {
  return {
    text: String(input.text || '').trim(),
    skillNames: uniqueStrings(input.skillNames),
    attachmentIds: uniqueStrings(input.attachmentIds),
    dismissedAlwaysSkills: uniqueStrings(input.dismissedAlwaysSkills)
  };
}

export function parseInput(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) return { type: 'empty' };
  if (trimmed.startsWith('!')) {
    return { type: 'shell', command: trimmed.slice(1).trim() };
  }
  return { type: 'chat', text: trimmed };
}
```

`composeSelectedSkills` must use `composeExplicitSkillPrompt`, reject unknown,
disabled, internal, or non-user-invocable skills, and keep `text` as the visible
message while returning the composed instructions as `modelText`.

- [ ] **Step 4: Write failing action-validation tests**

```js
test('spec revise requires pending spec and feedback', () => {
  assert.throws(
    () => validateChatAction({ name: CHAT_ACTIONS.SPEC_REVISE, payload: {} }, {
      pendingSpecApproval: { id: 'spec-1' }
    }),
    /feedback is required/
  );
  assert.deepEqual(
    validateChatAction({
      name: CHAT_ACTIONS.SPEC_REVISE,
      payload: { feedback: 'reduce scope' }
    }, { pendingSpecApproval: { id: 'spec-1' } }),
    { name: CHAT_ACTIONS.SPEC_REVISE, payload: { feedback: 'reduce scope' } }
  );
});

test('stale approval ids are rejected', () => {
  assert.throws(() => validateChatAction({
    name: CHAT_ACTIONS.APPROVAL_APPROVE,
    payload: { requestId: 'old' }
  }, { pendingApproval: { id: 'current' } }), /stale/i);
});
```

- [ ] **Step 5: Implement exact action constants and validation**

```js
export const CHAT_ACTIONS = Object.freeze({
  COMPACT: 'compact',
  DREAM: 'dream',
  CAPTURE: 'capture',
  INBOX: 'inbox',
  REFLECT: 'reflect',
  SPEC_PLAN_AND_EXECUTE: 'spec.plan-and-execute',
  SPEC_EXECUTE: 'spec.execute',
  SPEC_SAVE: 'spec.save',
  SPEC_REVISE: 'spec.revise',
  SPEC_REJECT: 'spec.reject',
  REFLECT_APPROVE: 'reflect.approve',
  REFLECT_REVISE: 'reflect.revise',
  REFLECT_REJECT: 'reflect.reject',
  APPROVAL_APPROVE: 'approval.approve',
  APPROVAL_REJECT: 'approval.reject'
});
```

Validation must trim feedback, require the matching pending state, compare
approval request IDs, and return a fresh normalized payload without mutating
the caller.

- [ ] **Step 6: Run focused tests**

Run:

```powershell
node --test tests/chat-action-dispatcher.test.js tests/chat-message.test.js tests/skill-command.test.js tests/command-directive-display.test.js
```

Expected: all listed tests PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/core/chat-action-dispatcher.js src/core/chat-message.js src/core/input-parser.js tests/chat-action-dispatcher.test.js tests/chat-message.test.js tests/skill-command.test.js tests/command-directive-display.test.js
git commit -m "refactor: define structured chat contracts"
```

---

### Task 2: Route Runtime Behavior Through Structured Calls

**Files:**
- Modify: `src/core/chat-runtime.js`
- Modify: `src/commands/run.js`
- Modify: `src/commands/chat.js`
- Create: `tests/chat-runtime-actions.test.js`
- Modify: `tests/chat-runtime.test.js`
- Modify: `tests/chat-runtime-prompt.test.js`
- Modify: `tests/skill-slash-normal-mode.test.js`

**Interfaces:**
- Consumes: `normalizeChatSubmission`, `composeSelectedSkills`, `validateChatAction`, `CHAT_ACTIONS`.
- Produces: `runtime.submitMessage(submission) -> Promise<turn result>`.
- Produces: `runtime.dispatchAction(action) -> Promise<action result>`.

- [ ] **Step 1: Write failing runtime tests for structured skills and actions**

```js
test('submitMessage keeps visible text separate from selected skill instructions', async () => {
  const runtime = await createTestRuntime();
  await runtime.submitMessage({ text: 'design this', skillNames: ['brainstorming'] });
  const user = runtime.getSession().messages.at(-1);
  assert.equal(user.content, 'design this');
  assert.match(user.model_content, /\[Executing skill: \/brainstorming\]/);
});

test('dispatchAction rejects an action outside its pending state', async () => {
  const runtime = await createTestRuntime();
  await assert.rejects(
    runtime.dispatchAction({ name: CHAT_ACTIONS.SPEC_SAVE, payload: {} }),
    /No pending spec review/
  );
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
node --test tests/chat-runtime-actions.test.js tests/chat-runtime.test.js tests/chat-runtime-prompt.test.js
```

Expected: FAIL because the runtime does not expose `submitMessage` or
`dispatchAction`.

- [ ] **Step 3: Extract runtime handlers and expose the structured API**

Add methods with these boundaries:

```js
async function submitMessage(submission) {
  const normalized = normalizeChatSubmission(submission);
  const composed = composeSelectedSkills(commands, normalized, {
    isEnabled: isRuntimeSkillEnabled
  });
  if (composed.error) throw new Error(composed.error);
  return submitChatTurn({
    visibleText: composed.text,
    modelText: composed.modelText,
    attachmentIds: normalized.attachmentIds,
    dismissedAlwaysSkills: normalized.dismissedAlwaysSkills
  });
}

async function dispatchAction(action) {
  const normalized = validateChatAction(action, getRuntimeState());
  return actionHandlers[normalized.name](normalized.payload);
}
```

Map each `CHAT_ACTIONS` value to the existing compact, dream, capture, inbox,
reflect, spec, and approval logic. Handlers must not call `handleLine()` with a
synthetic command.

- [ ] **Step 4: Remove interactive command routing**

Delete slash/directive branches from `handleLine`, completion generation, and
history special-casing. Keep `!command` shell handling only where already
supported. Update `src/commands/run.js` to parse its own CLI options and call
`submitMessage`/handlers directly; do not pass `command:[...]` through
`parseInput`.

- [ ] **Step 5: Run runtime and skill-routing tests**

Run:

```powershell
node --test tests/chat-runtime-actions.test.js tests/chat-runtime.test.js tests/chat-runtime-prompt.test.js tests/skill-slash-normal-mode.test.js tests/skill-command.test.js
```

Expected: all listed tests PASS with renamed assertions referring to selected
skills rather than slash skills.

- [ ] **Step 6: Commit**

```powershell
git add src/core/chat-runtime.js src/commands/run.js src/commands/chat.js tests/chat-runtime-actions.test.js tests/chat-runtime.test.js tests/chat-runtime-prompt.test.js tests/skill-slash-normal-mode.test.js tests/skill-command.test.js
git commit -m "refactor: dispatch structured runtime actions"
```

---

### Task 3: Add Structured Web Server Endpoints

**Files:**
- Modify: `codemini-web/server.js`
- Modify: `codemini-web/client/src/hooks/use-api.js`
- Create: `tests/web-chat-actions.test.js`

**Interfaces:**
- Consumes: `runtime.submitMessage({ text, skillNames, attachmentIds, dismissedAlwaysSkills })`.
- Consumes: `runtime.dispatchAction({ name, payload })`.
- Produces: `POST /api/chat/message`.
- Produces: `POST /api/chat/action`.
- Produces client helpers `submitMessage(body)` and `submitChatAction(name, payload)`.

- [ ] **Step 1: Write failing endpoint tests**

```js
test('message endpoint forwards structured fields', async () => {
  const response = await request('/api/chat/message', {
    method: 'POST',
    body: {
      text: 'review',
      skillNames: ['brainstorming'],
      attachmentIds: ['att-1']
    }
  });
  assert.equal(response.status, 202);
  assert.deepEqual(runtime.submitMessage.mock.calls[0][0].skillNames, ['brainstorming']);
});

test('action endpoint returns 409 for stale state', async () => {
  runtime.dispatchAction.mockRejectedValue(new ChatActionError('STALE_ACTION', 'Review changed'));
  const response = await request('/api/chat/action', {
    method: 'POST',
    body: { name: 'spec.save', payload: {} }
  });
  assert.equal(response.status, 409);
});
```

- [ ] **Step 2: Run the endpoint tests and verify failure**

Run:

```powershell
node --test tests/web-chat-actions.test.js
```

Expected: FAIL with missing routes.

- [ ] **Step 3: Implement endpoints and client helpers**

Server route shape:

```js
if (req.method === 'POST' && url.pathname === '/api/chat/action') {
  const body = await readJsonBody(req);
  try {
    const result = await runtime.dispatchAction({
      name: body?.name,
      payload: body?.payload || {}
    });
    jsonResponse(res, { ok: true, result }, 200);
  } catch (error) {
    const status = error?.code === 'STALE_ACTION' ? 409 : 400;
    jsonResponse(res, { error: true, code: error?.code, message: error.message }, status);
  }
  return;
}
```

Implement `/api/chat/message` with the same error envelope and accepted
submission fields. Remove `/api/completions` behavior that exists only for
slash commands.

- [ ] **Step 4: Run endpoint tests**

Run:

```powershell
node --test tests/web-chat-actions.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add codemini-web/server.js codemini-web/client/src/hooks/use-api.js tests/web-chat-actions.test.js
git commit -m "feat: expose structured chat action api"
```

---

### Task 4: Migrate WebUI Composer and Review Dialogs

**Files:**
- Modify: `codemini-web/client/src/components/InputBar.jsx`
- Modify: `codemini-web/client/src/context/app-context.jsx`
- Modify: `codemini-web/client/src/components/SpecApprovalDialog.jsx`
- Modify: `codemini-web/client/src/components/ReflectApprovalDialog.jsx`
- Modify: `codemini-web/client/src/components/ApprovalDialog.jsx`
- Modify: `codemini-web/client/src/lib/user-skill-prompt.js`
- Create: `codemini-web/client/src/lib/chat-action-names.js`
- Modify: relevant localization files under `codemini-web/client/src/i18n/`
- Create: `codemini-web/client/src/lib/chat-composer-state.js`
- Create: `tests/web-chat-composer.test.js`

**Interfaces:**
- Consumes: `api.submitMessage(body)` and `api.submitChatAction(name, payload)`.
- Produces: `createComposerState`, `toggleComposerSkill`, and `beginActionParameter` pure helpers.
- Produces: browser-safe `CHAT_ACTION_NAMES` constants whose values exactly match the runtime action contract.
- Produces: `InputBar.onSubmit({ text, skillNames, attachmentIds, dismissedAlwaysSkills })`.

- [ ] **Step 1: Write failing pure composer-state tests**

```js
test('skill selection toggles without rewriting text', () => {
  const state = createComposerState({ text: '/literal text' });
  const selected = toggleComposerSkill(state, { name: 'brainstorming' });
  assert.equal(selected.text, '/literal text');
  assert.deepEqual(selected.selectedSkills.map((skill) => skill.name), ['brainstorming']);
  assert.deepEqual(toggleComposerSkill(selected, { name: 'brainstorming' }).selectedSkills, []);
});

test('revision action preserves feedback when cancelled back to choices', () => {
  const editing = beginActionParameter(createComposerState(), 'spec.revise');
  const typed = { ...editing, parameterText: 'reduce scope' };
  assert.equal(cancelActionParameter(typed).parameterDrafts['spec.revise'], 'reduce scope');
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
node --test tests/web-chat-composer.test.js
```

Expected: FAIL because `chat-composer-state.js` does not exist.

- [ ] **Step 3: Implement pure composer state**

```js
export function createComposerState(seed = {}) {
  return {
    text: String(seed.text || ''),
    selectedSkills: [],
    activeAction: null,
    parameterText: '',
    parameterDrafts: {},
    ...seed
  };
}
```

Implement toggle, enter-parameter, cancel-parameter, and successful-submit
transitions without mutating prior state.

- [ ] **Step 4: Replace slash palette behavior with the `+` trigger**

In `InputBar.jsx`:

- rename `CommandPalette` to `ActionSkillPalette`;
- replace `slashOpen`/`slashQuery` with explicit palette open/search state;
- add a `Plus` icon button before the attachment button;
- remove the `handleInput` branches that inspect `/`;
- keep action and skill sections;
- toggle skills rather than generating `skill:[...]`;
- submit a structured object and clear state only after `onSubmit` resolves.

The trigger must have an accessible localized label such as `Add action or
skill`.

- [ ] **Step 5: Replace synthesized command strings in app context and dialogs**

Replace code equivalent to:

```js
await api.submitLine(`/edit ${feedback.trim()}`);
```

with:

```js
await api.submitChatAction('spec.revise', {
  feedback: feedback.trim()
});
```

Define `CHAT_ACTION_NAMES` in `chat-action-names.js` with the same stable string
values from Task 1, then map every spec, reflect, and generic approval button
through those constants. On errors, restore/retain the pending dialog and its
feedback. The server remains authoritative and rejects unknown names.

- [ ] **Step 6: Run focused tests and WebUI build**

Run:

```powershell
node --test tests/web-chat-composer.test.js tests/web-chat-actions.test.js
npm run build:web
```

Expected: tests PASS and Vite build exits 0.

- [ ] **Step 7: Commit**

```powershell
git add codemini-web/client/src/components/InputBar.jsx codemini-web/client/src/context/app-context.jsx codemini-web/client/src/components/SpecApprovalDialog.jsx codemini-web/client/src/components/ReflectApprovalDialog.jsx codemini-web/client/src/components/ApprovalDialog.jsx codemini-web/client/src/lib/user-skill-prompt.js codemini-web/client/src/lib/chat-action-names.js codemini-web/client/src/lib/chat-composer-state.js codemini-web/client/src/i18n tests/web-chat-composer.test.js
git commit -m "feat: add explicit web chat actions"
```

---

### Task 5: Implement TUI Selector and Review Controls

**Files:**
- Create: `src/tui/action-selector.js`
- Modify: `src/tui/chat-app.js`
- Create: `tests/tui-action-selector.test.js`
- Replace: `tests/tui-spec-approval.test.js`

**Interfaces:**
- Consumes: `runtime.submitMessage(submission)` and `runtime.dispatchAction(action)`.
- Produces: `createActionSelectorState(items)`.
- Produces: `reduceActionSelector(state, event)`.
- Produces: `reviewActionsForPendingState(runtimeState)`.

- [ ] **Step 1: Write failing selector-state tests**

```js
test('Ctrl+K selector supports filtering and skill toggling', () => {
  let state = createActionSelectorState([
    { kind: 'action', name: 'compact' },
    { kind: 'skill', name: 'brainstorming' }
  ]);
  state = reduceActionSelector(state, { type: 'query', value: 'brain' });
  state = reduceActionSelector(state, { type: 'select' });
  assert.deepEqual(state.selectedSkillNames, ['brainstorming']);
  assert.equal(state.open, true);
});

test('review state rejects arbitrary text events', () => {
  const state = createReviewSelectorState('spec');
  assert.deepEqual(reduceReviewSelector(state, { type: 'text', value: '/yes' }), state);
});

test('revision feedback is retained when returning to action choices', () => {
  let state = createReviewSelectorState('spec');
  state = reduceReviewSelector(state, { type: 'choose', name: 'spec.revise' });
  state = reduceReviewSelector(state, { type: 'feedback', value: 'tighten scope' });
  state = reduceReviewSelector(state, { type: 'cancel-feedback' });
  assert.equal(state.feedbackDrafts['spec.revise'], 'tighten scope');
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
node --test tests/tui-action-selector.test.js tests/tui-spec-approval.test.js
```

Expected: FAIL because the selector module does not exist and the old test
expects slash parsing.

- [ ] **Step 3: Implement pure selector reducers**

The reducer must support:

```js
{ type: 'open' }
{ type: 'close' }
{ type: 'query', value }
{ type: 'move', delta }
{ type: 'select' }
{ type: 'remove-skill', name }
{ type: 'choose', name }
{ type: 'feedback', value }
{ type: 'cancel-feedback' }
```

Selection wraps within filtered items. Skill selection toggles without closing;
action selection returns an effect `{ type: 'dispatch-action', action }`.

- [ ] **Step 4: Integrate `Ctrl+K` and structured submission in Ink**

Add the key branch before printable-input handling:

```js
if (key.ctrl && value === 'k' && !approvalLockActive) {
  setActionSelector((current) =>
    reduceActionSelector(current, { type: current.open ? 'close' : 'open' })
  );
  return;
}
```

Render Actions and Skills above the input. Use Up/Down for rows, Enter for
selection, and Esc to close. Render selected skill names beside the input and
submit them through `runtime.submitMessage`.

- [ ] **Step 5: Replace typed approval parsers with selectable review state**

Delete `parseSpecApprovalAnswer`, `parseReflectApprovalAnswer`, their input
strings, and invalid-command copy. Render valid action labels, use Left/Right
or Tab/Shift+Tab to move focus, Enter to dispatch, and Esc only to return from
feedback input.

Review copy must describe keys and actions without `/yes`, `/edit`, `/reject`,
or `/no`.

- [ ] **Step 6: Run TUI and runtime tests**

Run:

```powershell
node --test tests/tui-action-selector.test.js tests/tui-spec-approval.test.js tests/chat-runtime-actions.test.js
```

Expected: all listed tests PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/tui/action-selector.js src/tui/chat-app.js tests/tui-action-selector.test.js tests/tui-spec-approval.test.js
git commit -m "feat: add keyboard-driven tui actions"
```

---

### Task 6: Remove Legacy Copy and Verify the Migration

**Files:**
- Modify: `src/core/command-loader.js`
- Modify: `src/core/default-system-prompt.js`
- Modify: `src/core/session-store.js`
- Modify: `src/tui/chat-app.js`
- Modify: `codemini-web/client/src/components/MessageBubble.jsx`
- Modify: `codemini-web/client/src/lib/user-skill-prompt.js`
- Modify: affected tests under `tests/`
- Modify: `README.md` or command documentation only where it describes interactive slash/directive syntax.

**Interfaces:**
- Consumes all structured contracts from Tasks 1-5.
- Produces no new runtime interface.

- [ ] **Step 1: Add a failing legacy-protocol scan test**

```js
test('interactive UI sources do not contain legacy command protocols', async () => {
  const files = [
    'src/tui/chat-app.js',
    'codemini-web/client/src/components/InputBar.jsx',
    'codemini-web/client/src/context/app-context.jsx'
  ];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /command:\[|skill:\[|\/yes|\/reject|\/edit/);
  }
});
```

- [ ] **Step 2: Run the scan test and verify failure**

Run:

```powershell
node --test tests/legacy-chat-protocol.test.js
```

Expected: FAIL with remaining legacy strings.

- [ ] **Step 3: Remove remaining protocol-specific code and copy**

Use:

```powershell
rg -n 'command:\[|skill:\[|/yes|/reject|/edit|slash command|slash autocomplete' src codemini-web/client/src tests README.md
```

For every match, either remove/update interactive UI behavior and copy or
document why the match belongs exclusively to historical transcript rendering
or non-interactive CLI tests. Do not change generated `codemini-web/dist`.

- [ ] **Step 4: Run focused routing verification**

Run:

```powershell
node --test tests/skill-command.test.js tests/default-system-prompt.test.js tests/chat-runtime-actions.test.js tests/tui-action-selector.test.js tests/web-chat-actions.test.js tests/web-chat-composer.test.js tests/legacy-chat-protocol.test.js
```

Expected: all listed tests PASS.

- [ ] **Step 5: Run full verification**

Run:

```powershell
npm test
npm run build:web
```

Expected: all Node tests PASS and the WebUI build exits 0.

- [ ] **Step 6: Inspect the final diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: `git diff --check` exits 0; status lists only intended source, test,
and documentation changes.

- [ ] **Step 7: Commit**

```powershell
git add src codemini-web/client/src tests README.md
git commit -m "chore: remove legacy chat command protocols"
```
