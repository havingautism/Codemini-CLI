# Safe Delete Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a built-in `delete` tool that performs real workspace deletion only after explicit user confirmation, with a TUI confirmation dialog that blocks normal input and supports both Chinese and English.

**Architecture:** Extend the existing built-in tool registry with a destructive `delete` tool, then reuse the existing `requestToolApproval` hook in the agent loop to gate execution. The TUI will gain a dedicated approval-dialog state for delete requests so it can show path/name/type metadata, accept only `yes` or `no`, and temporarily disable the regular input workflow.

**Tech Stack:** Node.js, built-in `fs/promises`, existing tool registry in `src/core/tools.js`, existing agent execution flow in `src/core/agent-loop.js`, Ink/React TUI in `src/tui/chat-app.js`, node:test

---

### Task 1: Add failing tests for the delete tool handler

**Files:**
- Modify: `tests/tools.test.js`
- Reference: `src/core/tools.js`
- Reference: `src/core/fs-utils.js`

- [ ] **Step 1: Add a failing test for deleting a file**

Add a test near the other built-in tool tests in `tests/tools.test.js` that:

```js
test('delete removes a workspace file and returns structured metadata', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'obsolete.ts'), 'export const oldValue = 1;\n', 'utf8');

    const { handlers } = await makeTools(workspaceRoot);
    const result = await handlers.delete({ path: 'src/obsolete.ts' });

    assert.equal(result.ok, true);
    assert.equal(result.path, 'src/obsolete.ts');
    assert.equal(result.name, 'obsolete.ts');
    assert.equal(result.type, 'file');
    assert.equal(result.deleted, true);
    await assert.rejects(() => fs.stat(path.join(workspaceRoot, 'src', 'obsolete.ts')), /ENOENT/);
  });
});
```

- [ ] **Step 2: Add a failing test for deleting a directory**

Add a second test in `tests/tools.test.js` that creates `src/legacy/old.ts`, calls `handlers.delete({ path: 'src/legacy' })`, and asserts:

- `ok === true`
- `name === 'legacy'`
- `type === 'directory'`
- the directory no longer exists

- [ ] **Step 3: Add a failing test for missing delete targets**

Add a test in `tests/tools.test.js` that calls:

```js
await assert.rejects(
  () => handlers.delete({ path: 'src/missing.ts' }),
  /not exist|not found|ENOENT/i
);
```

- [ ] **Step 4: Run the focused tool tests and confirm they fail**

Run: `node --test tests/tools.test.js`

Expected: FAIL because `handlers.delete` does not exist yet or the tool definition is missing.

- [ ] **Step 5: Commit the red test state**

```bash
git add tests/tools.test.js
git commit -m "test: add delete tool handler coverage"
```

### Task 2: Add failing security and approval-flow tests

**Files:**
- Modify: `tests/security-hardening.test.js`
- Modify: `tests/tools.test.js`
- Reference: `src/core/agent-loop.js`

- [ ] **Step 1: Add a failing security test for symlink escape deletion**

Add a test in `tests/security-hardening.test.js` matching the existing read/write escape coverage:

```js
test('delete rejects removing symlinked paths that resolve outside the workspace', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const externalRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-security-external-'));
    try {
      await fs.mkdir(path.join(externalRoot, 'escape'), { recursive: true });
      await fs.writeFile(path.join(externalRoot, 'escape', 'secret.txt'), 'top-secret\n', 'utf8');
      await fs.symlink(path.join(externalRoot, 'escape'), path.join(workspaceRoot, 'linked-escape'), 'dir');

      const { handlers } = await makeTools(workspaceRoot);
      await assert.rejects(
        () => handlers.delete({ path: 'linked-escape/secret.txt' }),
        /workspace/i
      );
    } finally {
      await fs.rm(externalRoot, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Add a failing agent-loop approval-denied test**

Add a test in `tests/tools.test.js` that runs `runAgentLoop(...)` with:

- a fake model/tool-call sequence that emits one `delete` tool call
- `executionMode: 'normal'`
- a `requestToolApproval` stub returning `{ approved: false }`
- a `toolHandlers.delete` spy that should never be called

Assert that:

- approval is requested exactly once
- the delete handler is not executed
- the tool result message contains a blocked/cancelled payload

- [ ] **Step 3: Add a failing agent-loop approval-granted test**

Add a companion test in `tests/tools.test.js` with `requestToolApproval` returning `{ approved: true }` and assert:

- the delete handler is executed
- the tool result contains the handler result

- [ ] **Step 4: Run focused tests and confirm they fail**

Run: `node --test tests/security-hardening.test.js tests/tools.test.js`

Expected: FAIL due to the missing `delete` tool and missing approval-specific behavior.

- [ ] **Step 5: Commit the additional red tests**

```bash
git add tests/security-hardening.test.js tests/tools.test.js
git commit -m "test: cover delete approval and workspace safety"
```

### Task 3: Implement the built-in delete tool

**Files:**
- Modify: `src/core/tools.js`
- Reference: `src/core/string-utils.js`
- Reference: `src/core/fs-utils.js`

- [ ] **Step 1: Add argument normalization support for delete**

In `src/core/tools.js`, add a `normalizeDeleteArgs(rawArgs)` helper following the existing `normalizePathArgs` / `normalizeWriteArgs` style. It should canonicalize:

- `path`
- optional aliases such as `file` and `file_path`

Minimal shape:

```js
function normalizeDeleteArgs(rawArgs) {
  const source =
    rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
      ? { ...rawArgs }
      : { path: typeof rawArgs === 'string' ? rawArgs : '' };
  const normalized = { ...source };
  const targetPath = String(source.path || source.file_path || source.file || '').trim();
  if (targetPath) normalized.path = targetPath;
  return normalized;
}
```

- [ ] **Step 2: Add the delete tool schema to the built-in definitions**

Inside `getBuiltinTools(...)` in `src/core/tools.js`, add a `delete` schema near the other file tools. Use a destructive description and a required `path` string parameter.

Example shape:

```js
delete: {
  type: 'function',
  function: {
    name: 'delete',
    description: 'Delete a file or directory inside the workspace. This is destructive and may require user approval.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative path to the file or directory to delete' },
        file_path: { type: 'string', description: 'Alias for path' },
        file: { type: 'string', description: 'Alias for path' }
      },
      required: ['path']
    }
  }
}
```

- [ ] **Step 3: Implement the delete handler**

Add `handlers.delete = async (rawArgs) => { ... }` that:

1. normalizes args
2. rejects an empty path
3. resolves the target with `resolveInWorkspace(workspaceRoot, targetPath)`
4. stats the target before deletion
5. calls `fs.rm(resolvedTarget, { recursive: true, force: false })`
6. returns workspace-relative structured metadata

Minimal implementation target:

```js
const stat = await fs.stat(resolvedTarget);
const type = stat.isDirectory() ? 'directory' : 'file';
await fs.rm(resolvedTarget, { recursive: true, force: false });
return {
  ok: true,
  path: toWorkspaceRelative(workspaceRoot, resolvedTarget),
  name: path.basename(resolvedTarget),
  type,
  deleted: true
};
```

- [ ] **Step 4: Add a delete formatter**

Add `formatters.delete = (...) => ...` in `src/core/tools.js` so delete results summarize cleanly.

Recommended output:

```js
return `Deleted ${result.type} ${result.path}`;
```

If the repo’s existing formatter conventions prefer capitalized nouns or richer detail, follow that pattern.

- [ ] **Step 5: Run the focused tests and make them pass**

Run: `node --test tests/tools.test.js tests/security-hardening.test.js`

Expected: the direct handler and workspace-boundary tests now pass, while any remaining failures should be in approval metadata or TUI behavior.

- [ ] **Step 6: Commit the tool implementation**

```bash
git add src/core/tools.js tests/tools.test.js tests/security-hardening.test.js
git commit -m "feat: add workspace delete tool"
```

### Task 4: Extend the approval flow with delete-specific metadata and cancellation semantics

**Files:**
- Modify: `src/core/agent-loop.js`
- Modify: `src/core/chat-runtime.js`
- Modify: `tests/tools.test.js`
- Reference: `src/core/tools.js`

- [ ] **Step 1: Normalize delete tool arguments in the agent loop**

In `normalizeToolArguments(...)` inside `src/core/agent-loop.js`, add a `delete` branch that mirrors the new tool-side argument normalization:

```js
if (toolName === 'delete') {
  const value = String(source.path || source.file_path || source.file || stringValue || '').trim();
  if (value) source.path = value;
  return source;
}
```

- [ ] **Step 2: Add approval details for delete requests**

Before `requestToolApproval(...)` is called in `runAgentLoop(...)`, enrich the request payload for delete calls with an `approvalDetails` object. The object should include:

- `path`
- `name`
- `type`

Use the normalized tool args for `path`. If full metadata is easier to derive in the tool definition layer than in the loop, factor a small helper rather than duplicating business logic.

Preferred request shape:

```js
const approvalPayload = {
  id: call.id,
  name: toolName,
  displayName,
  arguments: args,
  approvalDetails: toolName === 'delete'
    ? {
        kind: 'delete',
        path: String(args.path || '').trim()
      }
    : undefined
};
```

If the final design needs `name` and `type` to come from a preflight stat performed outside the loop, adjust the payload shape accordingly, but keep the metadata explicit and structured.

- [ ] **Step 3: Return a cancellation payload when delete approval is denied**

When `approvalResults.get(call.id)` is false and the tool is `delete`, return a more specific blocked result than the generic approval message so the model can understand that the user actively rejected the deletion.

Target payload:

```js
{
  ok: false,
  path: args.path,
  deleted: false,
  cancelled: true,
  reason: 'User denied deletion approval'
}
```

Keep the existing generic blocked result for other tools.

- [ ] **Step 4: Thread requestToolApproval through the chat runtime**

Update the `createChatRuntime(...)` path in `src/core/chat-runtime.js` so `runAgentLoop(...)` receives a `requestToolApproval` callback instead of silently skipping approval handling in the TUI runtime.

Target direction:

- extend `createChatRuntime(...)` to accept an approval callback option, for example `requestToolApproval`
- pass that callback into `runAgentLoop(...)`
- keep the callback optional so non-TUI callers remain compatible

Minimal shape:

```js
export async function createChatRuntime({
  session,
  config: initialConfig,
  model,
  systemPrompt,
  requestToolApproval
}) { ... }
```

and later:

```js
const loopResult = await runAgentLoop({
  ...,
  requestToolApproval
});
```

- [ ] **Step 5: Run approval-focused tests**

Run: `node --test tests/tools.test.js`

Expected: approval denied and approval granted tests pass with the new delete-specific behavior.

- [ ] **Step 6: Commit the approval-flow changes**

```bash
git add src/core/agent-loop.js src/core/chat-runtime.js tests/tools.test.js
git commit -m "feat: require approval for delete tool execution"
```

### Task 5: Add the TUI delete confirmation dialog and bilingual copy

**Files:**
- Modify: `src/tui/chat-app.js`
- Reference: `src/core/chat-runtime.js`
- Modify: `tests/chat-app-plan-summary.test.js`
- Possibly create: `tests/chat-app-delete-approval.test.js` if extracting pure helpers is cleaner

- [ ] **Step 1: Add localized copy entries for delete approval**

Extend `TUI_COPY.zh` and `TUI_COPY.en` in `src/tui/chat-app.js` with a new section, for example:

```js
deleteApproval: {
  title: '确认删除？',
  pathLabel: '路径',
  nameLabel: '名称',
  typeLabel: '类型',
  fileType: '文件',
  directoryType: '目录',
  prompt: '输入 yes 确认删除，输入 no 取消。',
  invalidAnswer: '请输入 yes 或 no。',
  cancelled: '已取消删除'
}
```

and:

```js
deleteApproval: {
  title: 'Confirm deletion?',
  pathLabel: 'Path',
  nameLabel: 'Name',
  typeLabel: 'Type',
  fileType: 'file',
  directoryType: 'directory',
  prompt: 'Type yes to delete, or no to cancel.',
  invalidAnswer: 'Please enter yes or no.',
  cancelled: 'Deletion cancelled'
}
```

- [ ] **Step 2: Add pure helpers for delete approval presentation**

To keep TUI logic testable, add small exported helpers in `src/tui/chat-app.js`, such as:

```js
export function isDeleteApprovalRequest(request) { ... }
export function formatDeleteApprovalLines(copy, request) { ... }
```

`formatDeleteApprovalLines(...)` should produce a compact array of text lines containing title, labels, metadata, and prompt.

- [ ] **Step 3: Add state for pending delete approval**

In `ChatApp(...)`, add state like:

```js
const [pendingDeleteApproval, setPendingDeleteApproval] = useState(null);
const [deleteApprovalInput, setDeleteApprovalInput] = useState('');
const [deleteApprovalError, setDeleteApprovalError] = useState('');
```

Use the approval request details to populate:

- request id
- path
- name
- type

- [ ] **Step 4: Wire the runtime approval callback into the new state**

Find where the chat runtime bridges `requestToolApproval` into the TUI event loop. Update that path so a delete approval request:

- opens the delete dialog
- waits for the dialog answer
- resolves the approval promise with `{ approved: true }` for `yes`
- resolves with `{ approved: false }` for `no`

If there is no existing TUI-side approval bridge, add the smallest reusable abstraction needed to support this one request cleanly.

- [ ] **Step 5: Disable the normal input workflow while approval is pending**

In the main `useInput(...)` handler around the `key.return` and text-entry branches in `src/tui/chat-app.js`, short-circuit when `pendingDeleteApproval` is active.

Expected behavior:

- regular input field does not submit chat messages
- suggestion navigation does not run
- only approval text entry is accepted
- Enter submits only the approval answer

- [ ] **Step 6: Render the confirmation dialog**

Add a small presentational component or inline render block near the existing panels that displays:

- localized title
- localized labels
- workspace-relative path
- basename
- localized type
- localized prompt
- localized invalid-answer hint when needed

Keep the visual style aligned with the rest of the TUI; avoid introducing a brand-new layout system just for this dialog.

- [ ] **Step 7: Add TUI tests for the helper output and locale switching**

If pure helpers were added, write tests in `tests/chat-app-plan-summary.test.js` or a new focused test file asserting that:

- Chinese formatting includes `确认删除？`, `路径`, `名称`, `类型`
- English formatting includes `Confirm deletion?`, `Path`, `Name`, `Type`
- `file` vs `directory` render correctly per locale

- [ ] **Step 8: Add input-gating tests**

Add tests for the extracted gating logic or pure helper functions that prove:

- delete approval mode disables normal submission
- only `yes` and `no` are accepted
- invalid answers surface the localized hint

If this is difficult to test at the component level, extract a small pure function and test that instead of adding brittle full-UI tests.

- [ ] **Step 9: Run the TUI-focused tests**

Run: `node --test tests/chat-app-plan-summary.test.js tests/chat-app-input.test.js`

Expected: all new TUI helper and input-gating tests pass.

- [ ] **Step 10: Commit the TUI changes**

```bash
git add src/tui/chat-app.js tests/chat-app-plan-summary.test.js tests/chat-app-input.test.js
git commit -m "feat: add bilingual delete approval dialog"
```

### Task 6: Run full verification and prepare implementation handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-04-09-safe-delete-tool.md` if verification notes need updates

- [ ] **Step 1: Run the focused verification suite**

Run:

```bash
node --test tests/tools.test.js tests/security-hardening.test.js tests/chat-app-plan-summary.test.js tests/chat-app-input.test.js
```

Expected: PASS

- [ ] **Step 2: Run the broader regression suite for nearby systems**

Run:

```bash
node --test tests/chat-runtime.test.js
```

Expected: PASS or, if there are unrelated existing failures, capture the exact failing tests and confirm they are unrelated to delete approval work.

- [ ] **Step 3: Manually smoke-test the TUI dialog**

Run:

```bash
node bin/coder.js
```

Then trigger a prompt that causes the model to call `delete(...)` and verify:

- the delete confirmation dialog appears
- the regular input box is not active
- `no` cancels deletion
- `yes` allows deletion
- switching UI language shows the correct localized copy

- [ ] **Step 4: Update the plan checklist with any deviations**

If implementation required a helper file, a different test file, or a different approval payload shape, reflect that in this plan document before closing the work.

- [ ] **Step 5: Commit the final verification state**

```bash
git add docs/superpowers/plans/2026-04-09-safe-delete-tool.md
git commit -m "docs: finalize safe delete implementation plan"
```
