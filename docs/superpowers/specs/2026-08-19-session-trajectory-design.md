# Session Trajectory (轨迹) — Design

Date: 2026-08-19  
Status: approved for planning

## Goal

Add a **轨迹** view next to **对话** on the Web UI chat page. It shows the current session as a chronological execution log (SYSTEM / USER / CONTEXT / ASSISTANT / TOOL), plus Duration / Turns / Calls, search, and a Session log download.

The conversation UI stays unchanged. Trajectory is a separate tab that replaces only the middle transcript panel.

## Non-goals (v1)

- Input / Model / Tools Gantt (flame) timeline
- New backend event store or API
- Persisting historical system-prompt / context snapshots
- CLI / TUI trajectory view
- Changing `ChatPanel`, message bubbles, input bar, abort, sidebar, or files/terminal rail

## Placement

Chat page titlebar (existing `h-12` row) gets two line tabs: **对话** | **轨迹**.

- Tabs sit in the left cluster of the current titlebar, immediately after the project name (and git info when present). Do not add a second header row.
- Files and terminal buttons stay on the right.
- Selecting **对话** renders the current chat tree as today: `ChatPanel` + `RuntimeActivityStrip` + input bar + abort.
- Selecting **轨迹** keeps the same chrome below (activity strip, input bar, abort) and swaps only `ChatPanel` for `TrajectoryPanel`.
- Switching tabs does not abort a running turn.
- Changing `currentSessionId` resets the tab to **对话**.
- Empty sessions still show both tabs. Trajectory then shows an empty state.

Tab state is local UI in `App.jsx` `Shell` (`useState`). It is not stored in `app-context`, localStorage, or the URL.

## Data source

Client-only. Derive the log from the already-streaming UI transcript:

- `state.messages`
- `state.runtimeState` (and related session fields already on the client: cwd, model, mode)

No new server routes. No writes. Recompute on each render / message update so a live run updates trajectory while open.

## Event model

Pure function in `codemini-web/client/src/lib/session-trajectory.js`:

```js
buildTrajectory({ messages, runtimeState, projectCwd, isGeneral })
→ { metrics, events }
```

`metrics`:

| Field | Meaning |
| --- | --- |
| `durationMs` | Last usable timestamp minus first usable timestamp. `null` if either is missing. |
| `turns` | Count of user messages (`role` is `you` or `user`). |
| `calls` | Count of tool cards across assistant messages. |

`events` is an ordered list. Each event:

```js
{
  id,            // stable within the current messages array
  kind,          // 'system' | 'context' | 'user' | 'assistant' | 'tool' | 'skill'
  turn,          // 1-based turn index, or 0 for the leading SYSTEM row
  title,         // short label (tool name, "thinking", …)
  body,          // main text / JSON args
  preview,       // truncated output (tools) or empty
  status,        // 'running' | 'done' | 'error' | null
  startedAt,     // ISO string or null
  endedAt,       // ISO string or null
  durationMs,    // number or null
}
```

### Mapping

| Source | Trajectory row |
| --- | --- |
| Current runtime (once, first row, only if the session has at least one user/assistant message) | **SYSTEM** — model, provider, mode when those fields exist; omit missing pieces. Not the composed system prompt. |
| First user message | **USER** then one **CONTEXT** — cwd / general-chat, approval/sandbox mode if present. Same current snapshot, not a historical freeze. Later turns do not repeat CONTEXT. If `runtimeState` is empty, still emit CONTEXT with whatever project/cwd fields exist. |
| Later user messages | **USER** only. Starts turn N+1. |
| `thinking` segments | **ASSISTANT** — reasoning text. Final assistant reply text stays on the 对话 tab and is not duplicated as a trajectory row. |
| Tool cards | **TOOL** — name, args JSON, output preview, status, duration when the card has it. |
| `skill` segments | **SKILL** — name / summary. Extra tag beyond the screenshot; do not drop hook/skill info. |
| `handoff` segments | **ASSISTANT** body. |
| Abort dividers, empty text, unknown segment types | Skip. |
| `role === 'error'` | **ASSISTANT** with `status: 'error'`. |

A **turn** is one user message plus every following non-user message until the next user message.

Timestamp fallback order: segment `startedAt` / `endedAt`, tool card duration fields, message `at`. If duration cannot be computed, UI shows `—`.

## Trajectory UI

`TrajectoryPanel` only. None of this chrome appears on the 对话 tab.

Top tool row:

- Left: three checkboxes, all on by default. Labels include the metric value (zh: `时长 1m 12s` / `回合 3` / `调用 14`; en: `Duration 1m 12s` / `Turns 3` / `Calls 14`).
  - **Duration** — when checked, show `durationMs` (or `—`) on each row
  - **Turns** — when checked, show `Turn N` grouping labels; off flattens the list
  - **Calls** — when checked, include TOOL and SKILL rows; off hides them
- Right: search input, then **Session log** download

Below: vertical log, left rail dots, color-coded kind tags (SYSTEM grey, USER blue, CONTEXT green, ASSISTANT purple, TOOL orange, SKILL teal). Long `body` / `preview` truncate at 240 characters; click expands in place.

Search is case-insensitive substring over `kind`, `title`, `body`, `preview`. Empty query shows all rows that pass the checkboxes.

Empty session copy: no events yet (i18n).

## Session log export

Client download only. Filename:

`codemini-trajectory-{sessionId}-{YYYYMMDDHHmmss}.json`

Payload:

```json
{
  "sessionId": "",
  "exportedAt": "",
  "metrics": {},
  "events": []
}
```

Export the unfiltered event list (ignore current search / checkboxes) so the file is a full snapshot. On failure, show a short error line inside `TrajectoryPanel` (same local-error pattern as `TerminalPanel`); do not crash the tab.

## Components and files

| File | Change |
| --- | --- |
| `codemini-web/client/src/App.jsx` | Titlebar tabs; conditional middle panel; reset tab on session change |
| `codemini-web/client/src/components/TrajectoryPanel.jsx` | Trajectory chrome + log |
| `codemini-web/client/src/lib/session-trajectory.js` | `buildTrajectory`, `filterTrajectoryEvents`, duration formatting helpers |
| `codemini-web/client/i18n/zh.js`, `en.js` | 轨迹/Trajectory, checkbox labels, search placeholder, Session log, empty state, kind tags |
| `tests/session-trajectory.test.js` | Builder + filter tests |

Do not edit `codemini-web/dist`. Do not change chat runtime or SQLite transcript persistence.

## Errors and edges

- Missing timestamps → `durationMs: null`, UI `—`
- Malformed tool args → stringify with `String(...)` / safe JSON; still emit the TOOL row
- Streaming thinking / running tools → `status: 'running'`, preview may grow live
- Download failure → local error line in `TrajectoryPanel`, do not crash the tab
- No session id → disable Session log

## Testing

- `node --test tests/session-trajectory.test.js` covering: empty messages, turn split, thinking → ASSISTANT and no duplicate final reply, tool cards → TOOL / calls count, SYSTEM+CONTEXT once, search, Duration/Turns/Calls filters, skipped abort dividers
- `npm test` after wiring
- `npm run build:web` for UI compile

No React DOM snapshot test. Conversation layout is preserved by not wrapping `ChatPanel` and by keeping trajectory chrome inside `TrajectoryPanel` only.

## Follow-up (not this change)

- Input / Model / Tools time bar
- Dedicated event log with per-call timestamps
- SYSTEM row showing the real composed system prompt
- Historical CONTEXT per turn
