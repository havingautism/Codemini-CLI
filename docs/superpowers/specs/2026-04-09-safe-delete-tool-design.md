# Safe Delete Tool Design

## Summary

Add a built-in `delete` tool for Codemini that performs real filesystem deletion inside the workspace, but only after explicit user confirmation in normal mode.

This is not a recycle-bin or soft-delete feature. The safety model comes from:

- strict workspace-bound path validation
- explicit confirmation before execution
- a TUI approval dialog that blocks the normal input box
- clear target disclosure in the confirmation copy

The confirmation flow must support both Chinese and English through the existing TUI copy system.

## Goals

- Add a first-class built-in tool named `delete`
- Allow deletion of both files and directories
- Require explicit user confirmation before deletion in normal mode
- Show the target path, file or directory name, and type in the confirmation UI
- Disable the main input box while the confirmation prompt is active
- Support bilingual confirmation and result copy through the existing locale system
- Preserve existing workspace security guarantees

## Non-Goals

- No recycle bin, trash, or `.codemini-project/deleteFiles` staging area
- No rename-then-move behavior
- No partial deletion preview or diff view
- No custom confirmation phrases beyond `yes` and `no`
- No out-of-workspace deletion support

## User Experience

### Model-level behavior

The assistant can call:

```json
delete({ "path": "src/example.ts" })
```

In normal mode, the tool call does not execute immediately. Instead, it enters the tool approval flow and waits for the user's decision.

If approved, deletion proceeds.
If denied, the tool result is returned as a cancellation so the model can react appropriately.

### TUI confirmation behavior

When a `delete` tool call is pending approval:

- a dedicated confirmation dialog is shown
- the normal message input box is disabled
- normal typing, suggestion navigation, history navigation, and regular submit behavior are suspended for the duration of the dialog
- only `yes` or `no` is accepted

The dialog must clearly show:

- target path
- target name
- target type: `file` or `directory`

### Example copy

Chinese:

- Title: `确认删除？`
- Path label: `路径`
- Name label: `名称`
- Type label: `类型`
- Type value for file: `文件`
- Type value for directory: `目录`
- Prompt: `输入 yes 确认删除，输入 no 取消。`

English:

- Title: `Confirm deletion?`
- Path label: `Path`
- Name label: `Name`
- Type label: `Type`
- Type value for file: `file`
- Type value for directory: `directory`
- Prompt: `Type yes to delete, or no to cancel.`

## Tool Contract

### Name

`delete`

### Arguments

```json
{
  "path": "string"
}
```

Aliases are optional. If existing tool conventions are followed, `file` and `file_path` may also be normalized into `path`, but `path` remains the canonical argument.

### Successful result

```json
{
  "ok": true,
  "path": "src/example.ts",
  "name": "example.ts",
  "type": "file",
  "deleted": true
}
```

For directories:

```json
{
  "ok": true,
  "path": "src/legacy",
  "name": "legacy",
  "type": "directory",
  "deleted": true
}
```

### Cancelled result

```json
{
  "ok": false,
  "path": "src/example.ts",
  "name": "example.ts",
  "type": "file",
  "deleted": false,
  "cancelled": true,
  "reason": "User denied deletion approval"
}
```

### Failure result

Failures should continue using the existing error path by throwing from the handler so the agent loop can format the failure consistently.

Expected failure cases:

- missing `path`
- path does not exist
- path resolves outside the workspace
- target metadata cannot be read
- filesystem delete failure

## Security Rules

### Workspace boundary

The tool must reuse the same workspace-safe path resolution used by existing file tools. A target must never be deleted if it resolves outside the workspace, including through symlink escapes.

### Existence check

Deletion approval should only be requested after the target has been resolved and confirmed to exist. If the path does not exist, fail immediately without showing the approval UI.

### Type awareness

The handler must stat the target before approval metadata is finalized so the UI can accurately show whether the target is a file or directory.

### Actual deletion

Deletion should use Node filesystem APIs directly, for example:

```js
await fs.rm(resolvedPath, { recursive: true, force: false });
```

This gives correct behavior for both files and directories while still failing on missing targets or permission issues.

## Architecture

## 1. Built-in tool definition

Add a `delete` built-in tool definition in `src/core/tools.js` alongside the existing file tools.

The definition should:

- describe the tool as a destructive file operation
- declare a required `path` string parameter
- be treated as a write tool, not a read-only tool

The handler should:

1. normalize arguments
2. resolve the target within the workspace
3. stat the target
4. delete it
5. return structured metadata

### Formatter

Add a tool formatter for `delete` so the UI gets compact, readable summaries.

Examples:

- `Deleted file src/example.ts`
- `Deleted directory src/legacy`
- localized formatter strings are optional at the formatter layer if the project currently keeps tool summaries language-neutral

## 2. Approval metadata

The existing `requestToolApproval` flow in `src/core/agent-loop.js` should be reused.

The approval request payload for `delete` should include enough structured information for the TUI to render a high-quality confirmation dialog:

- tool name
- display name
- normalized arguments
- workspace-relative path
- basename
- target type

This can be done either by:

- enriching the approval request object for `delete`, or
- introducing a generic optional `approvalDetails` field that special tools can populate

Preferred direction:

- add a small generic `approvalDetails` field
- populate it for `delete`

This keeps the approval pipeline reusable for future destructive tools.

## 3. TUI exclusive confirmation state

`src/tui/chat-app.js` needs a dedicated piece of state for pending destructive approval.

Suggested state shape:

```js
{
  id: string,
  toolName: 'delete',
  path: string,
  name: string,
  type: 'file' | 'directory'
}
```

When this state is active:

- the standard input workflow must be bypassed
- Enter should submit only the approval answer
- the main input should appear disabled or unavailable
- the dialog should remain visible until a valid answer is provided

### Input handling rules

- `yes` approves
- `no` denies
- any other input is ignored or produces a short validation hint

The simplest acceptable version is to ignore invalid input and keep the dialog open.

## 4. Localization

All user-facing delete-confirmation copy must be added to the existing `TUI_COPY.zh` and `TUI_COPY.en` objects in `src/tui/chat-app.js`.

Required copy keys include:

- dialog title
- field labels
- type labels
- prompt text
- invalid-answer hint
- cancelled summary text if shown in TUI

No delete confirmation strings should be hardcoded inline.

## Testing Strategy

## Tool tests

Add tests covering:

- deleting a file in the workspace
- deleting a directory in the workspace
- rejecting a missing path
- rejecting symlink escape deletion

Likely files:

- `tests/tools.test.js`
- `tests/security-hardening.test.js`

## Agent loop tests

Add tests covering:

- `delete` requires approval in normal mode
- approval denied returns a cancelled tool result
- approval granted executes the handler

Likely file:

- `tests/tools.test.js`

## TUI tests

Add tests covering:

- delete approval dialog renders the expected metadata
- main input is disabled while approval is pending
- `yes` confirms
- `no` cancels
- Chinese and English copy both render correctly

Likely file:

- existing chat app or plan-summary style test suite, depending on where TUI interaction tests already live

## Open Design Choices

### Invalid confirmation input

Recommended behavior:

- keep the dialog open
- show a short localized hint telling the user to enter `yes` or `no`

### Absolute vs relative path display

Recommended behavior:

- display the workspace-relative path in the dialog

Reason:

- shorter
- easier to read
- consistent with the rest of the tool UX

### Delete tool availability in safe mode

The current request states that safe mode is disabled, but the design should remain coherent if safe mode is enabled later.

Recommended behavior:

- the tool can remain registered
- actual execution still depends on the normal approval flow and any broader mode-level restrictions already enforced by the runtime

## Implementation Plan Preview

The expected implementation will likely touch:

- `src/core/tools.js`
- `src/core/agent-loop.js`
- `src/tui/chat-app.js`
- `tests/tools.test.js`
- `tests/security-hardening.test.js`
- one or more TUI-related test files

## Review Notes

This design intentionally chooses real deletion plus explicit confirmation over soft-delete mechanics because:

- the user requested a normal delete tool with approval
- the existing architecture already has an approval hook
- UI-based confirmation is easier to understand than hidden trash semantics
- it avoids introducing cleanup, restore, and retention policy complexity
