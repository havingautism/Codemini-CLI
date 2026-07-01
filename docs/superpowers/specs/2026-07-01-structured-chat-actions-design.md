# Structured Chat Actions Design

## Summary

Replace slash-triggered commands and skills in the WebUI and TUI with explicit
controls backed by structured runtime actions.

The WebUI will expose the existing Actions/Skills palette from a `+` button at
the far left of the input toolbar. The TUI will expose an equivalent selector
with `Ctrl+K`. Review and approval flows will use selectable actions instead of
requiring users to type command strings.

This change removes `/command`, `command:[...]`, and `skill:[...]` as
interactive chat protocols. A slash in a chat message becomes ordinary text.
Non-interactive `codemini run` arguments remain a separate interface.

## Goals

- Make actions and per-message skills discoverable without slash syntax.
- Give the WebUI and TUI the same action semantics.
- Prevent approval and review states from accepting arbitrary command text.
- Preserve existing action behavior while replacing text parsing with typed
  runtime calls.
- Keep selected skills attached to one message without changing installation or
  enablement state.

## Non-goals

- Installing, creating, editing, or deleting skills from the chat input.
- Redesigning the existing Skill management panel.
- Replacing the non-interactive `codemini run` interface.
- Introducing a general plugin API for third-party UI actions.
- Refactoring unrelated chat runtime behavior.

## Chosen Approach

Add a structured runtime action dispatcher and adapt the WebUI and TUI to call
it directly.

Existing command implementations remain the source of business behavior.
Handlers are extracted or wrapped so both structured actions and existing
internal runtime code can call them without synthesizing user text.

Rejected alternatives:

1. **UI-only migration.** Hiding slash syntax while continuing to generate
   command strings internally would preserve the current parsing ambiguity and
   keep UI behavior coupled to text formatting.
2. **Fully declarative command registry.** A new extensible action framework
   would be useful beyond this feature, but it expands the scope without being
   required for the requested interaction.

## Interaction Design

### WebUI

- Add a `+` button as the leftmost control in the chat input toolbar.
- Clicking it opens the current upward-opening palette.
- Keep the palette grouped into `Actions` and `Skills`.
- Selecting a skill toggles it for the current message.
- Selected skills appear as removable chips above the input.
- Selecting an action with no arguments executes it immediately.
- Selecting an action that needs input changes the composer into a
  purpose-specific parameter state.
- Submitting a normal message sends its text, attachments, dismissed default
  skills, and selected skill names as structured fields.
- Preserve the draft, attachments, and selected skills when submission fails.
  Clear them only after the request is accepted.
- Typing `/` has no special UI behavior.

### TUI

- `Ctrl+K` opens an Actions/Skills selector. It does not conflict with current
  Codemini TUI bindings (`Ctrl+C`, `Ctrl+T`, and `Ctrl+J`).
- The selector supports keyboard filtering and navigation.
- Selecting a skill toggles it for the current message and leaves the selector
  available for additional skill selection.
- Selected skills are shown near the input and can be removed before sending.
- Selecting an action executes it or enters its required parameter state.
- `Esc` closes the selector without changing the draft.
- Typing `/` inserts ordinary text and does not open suggestions.

### Review and Approval States

Approval states render only the actions valid for that state. Users cannot type
arbitrary chat text while an approval state is active.

- Use Left/Right or Tab/Shift+Tab to change the focused action.
- Use Enter to execute the focused action.
- Do not map Esc to rejection; accidental cancellation must not perform a
  destructive decision.
- When an action requires text, such as revision feedback, selecting it opens a
  dedicated input state.
- In a feedback input state, Enter submits non-empty feedback and Esc returns to
  action selection without losing the typed feedback.

Spec review actions:

- `plan-and-execute`
- `execute`
- `save`
- `revise`, with a non-empty `feedback` payload
- `reject`

Reflect review actions:

- `approve`
- `revise`, with a non-empty `feedback` payload
- `reject`

Delete, command-run, and file-change approvals expose only `approve` and
`reject`.

## Runtime Architecture

### Action Contract

Introduce one runtime entry point with an explicit contract equivalent to:

```js
dispatchAction({
  name,
  payload,
  context
})
```

- `name` is a stable action identifier.
- `payload` contains validated action parameters.
- `context` identifies the session and, when applicable, the pending approval
  request.

The dispatcher validates that the action exists and is allowed in the current
runtime state before calling its handler.

### Message Contract

A normal chat submission carries:

```js
{
  text,
  skillNames,
  attachmentIds,
  dismissedAlwaysSkills
}
```

Skill names are deduplicated and validated against enabled, user-invocable
skills. The runtime composes selected skill instructions for the model without
rewriting the visible user message.

### State Validation

- Every review action is checked against the current pending review type.
- Approval actions include the pending request identifier.
- Repeated, stale, or invalid actions fail without mutating state.
- Feedback actions reject blank feedback after trimming.
- A successful action emits the existing state-cleared and progress events so
  current consumers continue to update correctly.

### Transport

- WebUI API/WebSocket messages carry structured message and action payloads.
- TUI calls the same runtime methods directly.
- Transport responses distinguish validation errors from runtime failures so
  each UI can show an actionable message and retain user input.

## Removing Text Command Protocols

Remove interactive support for:

- `/name` slash commands
- `command:[name]`
- `skill:[name-a,name-b]`

This includes:

- input parsing branches
- slash autocomplete and suggestion state
- command-string generation in WebUI and TUI
- command-specific history and display parsing
- startup hints, placeholders, help text, and translations
- spec and reflect answer parsers
- tests that assert legacy interactive syntax

Internal code must not generate these strings as a substitute for calling the
action or message API.

## Error Handling

- Unknown action: show an unsupported-action error.
- Action invalid for current state: show that the review or approval has
  changed and refresh the available actions.
- Missing or invalid payload: keep the parameter input active and show a local
  validation message.
- Transport or runtime failure: retain the draft, attachments, feedback, and
  selected skills.
- Skill unavailable at submission time: identify the unavailable skill and
  leave the message unsent so the user can remove it or retry.

## Testing

### Core

- `/` is parsed as ordinary chat text.
- Legacy command and skill directives are not interpreted.
- Structured messages compose zero, one, or multiple selected skills correctly.
- Disabled, unknown, duplicate, and internal skills are handled correctly.
- Actions are accepted only in valid runtime states.
- Stale approval identifiers and blank revision feedback are rejected.
- Existing compact, reflect, spec, mode, and approval behavior is preserved
  through direct handlers.

### WebUI

- The `+` button is the leftmost input-toolbar control.
- The palette opens upward and shows Actions and Skills.
- Skills can be toggled, removed, submitted, and retained after failure.
- Parameterized actions enter and leave dedicated input states correctly.
- No slash-triggered palette behavior remains.
- Review dialogs submit structured actions.

### TUI

- `Ctrl+K` opens and closes the selector.
- Keyboard filtering, navigation, skill toggling, and action execution work.
- Review actions are selectable and arbitrary input is blocked.
- Revision feedback supports submit, validation, and return-to-selection.
- Existing `Ctrl+C`, `Ctrl+T`, and `Ctrl+J` behavior remains intact.
- Slash characters are ordinary input.

### Verification

- Run `npm test`.
- Run `npm run build:web`.

## Migration Boundary

This is an intentional breaking change to interactive chat command syntax.
There is no compatibility alias for slash commands or directive strings in the
WebUI or TUI. Saved transcripts remain readable as historical text but do not
re-execute command syntax.

The non-interactive `codemini run` interface remains supported and should call
runtime handlers through its own argument parsing rather than the removed chat
protocol.
