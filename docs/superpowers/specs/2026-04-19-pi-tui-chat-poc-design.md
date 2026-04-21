# Pi TUI Chat POC Design

Date: 2026-04-19
Status: Draft for review

## Goal

Build a minimal `pi-tui` proof of concept as a new standalone chat command that keeps the current CodeMini chat UI's core information structure and overall feel, while specifically addressing the scroll-reset behavior seen in the Ink-based UI during streaming and animated updates.

This is a validation project, not a full migration.

## Scope

The POC will add a new standalone command path, tentatively `codemini chat-pi`, without changing the default `codemini chat` Ink flow.

The POC must include:

- A standalone interactive chat entrypoint
- Reuse of the existing chat runtime from `src/core/chat-runtime.js`
- Reuse of existing tool narration and tool activity formatting where practical
- A `pi-tui`-based screen with:
  - header/session summary
  - message stream
  - input area
  - runtime status
  - tool activity summary
  - expandable or collapsible tool detail area
- Streaming output behavior that does not clear the terminal in a way that resets scrollback position

The POC will not include:

- Replacing the existing Ink chat command
- Full parity for all Ink keyboard behaviors
- Full slash-command completion parity
- All current decorative animations or visual flourishes
- A large refactor of runtime or provider code

## Success Criteria

The POC is considered successful if it demonstrates all of the following:

1. Users can launch a dedicated `pi-tui` chat mode without affecting the existing Ink UI.
2. Users can submit input and receive streaming assistant output.
3. Tool activity summary and detail rendering are visible in the `pi-tui` UI.
4. Expanding or collapsing tool details does not trigger a full-screen reset that yanks the terminal scroll position back to the top.
5. The screen organization feels recognizably aligned with the current Ink chat UI, even if some motion details are simplified.

## Approach Options Considered

### Option A: Keep runtime, add a `pi-tui` view adapter

Create a new command and a small `src/tui-pi/` view layer that subscribes to existing runtime events and formats them into `pi-tui` components.

Pros:

- Lowest risk
- Preserves existing business logic
- Best fit for a focused validation project
- Easy side-by-side comparison with Ink

Cons:

- Temporary duplication between Ink and `pi-tui` view layers
- Some state shaping may be needed for the new renderer

### Option B: Port the entire current chat UI logic directly

Move most of the current `src/tui/chat-app.js` behavior into `pi-tui` in one pass.

Pros:

- More direct path toward future migration

Cons:

- Too large for a POC
- High risk of mixing migration work with validation work
- Harder to isolate whether issues come from `pi-tui` or the rewrite itself

### Option C: Build a read-only viewer first

Build a non-interactive or lightly interactive viewer before adding real input and tool summaries.

Pros:

- Fastest way to render something on screen

Cons:

- Does not validate the user-facing problem that matters here
- Too weak for comparing scroll behavior during real streaming and tool updates

### Recommendation

Use Option A.

It keeps the experiment tight: reuse the existing chat runtime and presenter logic, then validate whether `pi-tui` can render the same core experience with more stable scroll behavior.

## High-Level Design

### Command Surface

Add a new chat entrypoint alongside the current Ink path.

Planned behavior:

- `codemini chat-pi`
- optionally `codemini pi` only if the initial implementation stays small and naming remains clear

For the POC, `chat-pi` is preferred because it is explicit and avoids ambiguity during comparison and testing.

### Runtime Reuse

The existing chat runtime remains the source of truth for:

- session handling
- provider calls
- tool execution lifecycle
- streaming assistant text
- plan and tool state progression

This reduces risk and ensures the POC is evaluating the rendering layer rather than rebuilding chat logic.

### View Layer

Create a new `src/tui-pi/` area with focused modules rather than one large file.

Expected module responsibilities:

- command bootstrap and terminal lifecycle
- state adapter from runtime events to renderable screen state
- message stream renderer
- tool activity summary/detail renderer
- input component
- shared formatting helpers for width-safe terminal output

The modules should stay intentionally small so the POC remains understandable and easy to replace or expand later.

### Rendering Strategy

The `pi-tui` screen should favor stable incremental updates over flashy redraws.

Design rules:

- Do not clear the full terminal during normal streaming updates
- Keep prior output stable whenever new assistant tokens arrive
- Treat tool summary expand or collapse as a local view update, not a full screen reset
- Prefer a conservative refresh model even if it means fewer animations than Ink

The main question this POC answers is whether `pi-tui` can keep viewport behavior stable while still presenting a structured chat layout.

## UI Structure

The POC should visually echo the current Ink layout without trying to reproduce every ornament.

Planned screen sections:

1. Header
   Shows product name, session or model context, and a small status summary.
2. Message Stream
   Shows the conversation in chronological order with distinct styling for user, assistant, system, and error states.
3. Tool Activity Panel
   Shows a compact summary of recent tool activity plus a toggleable detail area.
4. Composer
   Shows the current user input box and send or status hints.
5. Footer Status
   Shows current mode such as idle, thinking, streaming, or tooling.

The information hierarchy should remain similar enough that a user familiar with the Ink UI can immediately recognize where to look.

## Interaction Model

The POC only needs a narrow, deliberate interaction set.

Must support:

- typing input
- submitting input
- exiting the session cleanly
- toggling tool detail expansion or collapse

May support if trivial:

- simple input history
- a small subset of existing shortcuts

Not required in the POC:

- full command palette behavior
- full suggestion navigation system
- advanced debug shortcuts

## Scroll Stability Requirement

This is the central requirement of the POC.

The implementation must avoid the current Ink issue where certain animated or oversized redraw paths effectively reset terminal scroll position and make scrollback inspection frustrating.

Acceptance expectation:

- During assistant streaming, the user can rely on normal terminal scrollback behavior.
- During tool state updates, the screen does not jump back to the top.
- During tool detail expansion or collapse, content updates without a destructive clear-screen cycle.

The POC does not need perfect virtual scrolling. It only needs to prove that the rendering approach is materially more stable than the current Ink path for this problem.

## Error Handling

The POC should preserve the current chat behavior for runtime and provider errors as much as practical.

Requirements:

- render recoverable errors in-band in the message stream or status area
- exit cleanly on fatal terminal lifecycle errors
- avoid leaving the terminal in a broken raw-input state after exit

## Testing Strategy

Testing should focus on confidence in behavior, not complete migration parity.

Planned verification areas:

- command parsing for the new entrypoint
- rendering helpers that shape message or tool activity text
- state adapter behavior for streaming, tooling, and idle transitions
- at least one focused test covering expand or collapse state behavior for tool details

Manual verification is also required for the terminal-specific success criteria:

- streaming output remains stable
- scrollback is preserved
- tool detail toggling does not cause full-screen reset behavior

## Implementation Boundaries

This project should not silently become a migration.

Explicit boundaries:

- no removal of Ink dependencies yet
- no rewrite of `src/core/chat-runtime.js` unless a narrow adapter seam is required
- no attempt to reach feature parity before proving the scroll behavior win

If the POC proves promising, a later phase can decide whether to:

- expand the `pi-tui` path
- make it selectable behind a flag
- eventually replace the Ink path

## Open Decisions Resolved

- Command strategy: standalone command first
- UI target: consistent with current Ink information structure
- Feature slice: include tool summary and collapsible detail area
- Primary product goal: eliminate destructive redraw behavior that resets scrolling

## Review Checklist

- Scope is intentionally limited to a validation POC
- Existing runtime is reused rather than rewritten
- The command stays isolated from the default Ink flow
- Scroll stability is defined as the main acceptance target
- Tool activity summary and detail view are included in the POC surface
