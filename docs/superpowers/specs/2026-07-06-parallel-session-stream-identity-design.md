# Parallel Session Stream Identity Design

## Problem

While two sessions run concurrently, switching to a background session during
streaming can split one assistant response into multiple rendered messages.
Refreshing after completion repairs the display because the page then rebuilds
the transcript only from the server-persisted UI transcript.

The live client cache and the server UI transcript currently assign different
IDs to the same assistant response:

- Background SSE reduction falls back to `session-stream-<sessionId>`.
- `RuntimeBridge` persists the response under a generated `ui-*` ID.
- Session switching loads the server snapshot and then appends the cached SSE
  message, so both representations remain visible.

The switch path also captures an old SSE message object. Deltas received while
the snapshot is loading can therefore be overwritten or reattached from stale
state.

## Goals

- One assistant response has one stable ID across runtime events, SSE delivery,
  client caches, session switches, and persisted UI transcripts.
- Switching sessions during streaming renders exactly one response and retains
  every delta exactly once.
- Foreground and background session events remain isolated.
- Repeated switches do not duplicate messages or reset active streaming state.
- A completed response has the same structure before and after page refresh.

## Non-goals

- Adding durable SSE replay or a general event-sourcing protocol.
- Refactoring unrelated plan, approval, tool, or project-index behavior.
- Changing persisted model conversation formats.

## Chosen Approach

`RuntimeBridge` owns assistant message identity.

When `assistant:start` creates or resumes the active UI transcript message, the
bridge publishes the event with that message's stable `messageId`. Subsequent
assistant delta, reasoning, response, and relevant message-targeting events use
the same ID until the response finishes. The ID stored in the UI transcript is
therefore identical to the ID observed by the browser.

The client uses `event.messageId` as the only assistant stream key. The
`session-stream-*` fallback may remain only as defensive compatibility for old
or third-party events, but session switching must not contain special handling
for that fallback.

## RuntimeBridge Changes

`RuntimeBridge` will make UI event recording return the publishable event or
the active UI message ID. The event callback will record first, then publish an
event enriched with `messageId`.

Required behavior:

1. `assistant:start` creates or resumes the server UI message.
2. The published start event contains the resulting UI message ID.
3. Every following assistant event for that response contains the same ID.
4. The persisted `getUiMessages()` entry uses that ID.
5. A later assistant response receives a new ID after the previous response is
   finalized.

The bridge remains the identity authority; the browser must not invent a
second canonical ID.

## Client State Changes

Runtime metadata and transcript mutation will be separated conceptually:

- Runtime events update `sessionRuntimeById` for every tagged session.
- Background transcript events update only
  `sessionMessagesById[event.sessionId]`.
- Visible-session rendering continues to use the existing rich event handling,
  but `assistant:start` uses `event.messageId` when creating the message.

This prevents the current transcript from being independently mutated by both
the background reducer and the visible rich-message handler.

The implementation should preserve functional state updates and avoid
subscribing callbacks to rapidly changing React state. Session ownership is
read from the event and current-session refs, keeping callbacks stable and
avoiding unnecessary EventSource reconnections.

## Session Switch Reconciliation

Switching performs one functional reconciliation:

1. Activate the target session's cached transcript immediately.
2. Load the server session snapshot.
3. Merge snapshot messages with the latest cached transcript by stable ID.
4. For a matching in-progress message, preserve the latest cached live fields
   and merge server-only metadata.
5. Do not append a separately captured SSE message object.
6. Restore the active-message ref from the reconciled transcript.

The reconciliation callback reads the latest state at commit time. It must not
use a message object captured before asynchronous work.

Messages with different IDs remain separate and keep server order. Matching
IDs produce one message. The live version wins for streaming text and status;
the server version supplies metadata absent from the live version.

## Error and Compatibility Behavior

- Events missing `sessionId` cannot mutate per-session state.
- Events missing `messageId` may use the existing defensive fallback while
  live, but switching does not preserve a duplicate fallback message when the
  server snapshot already has an active assistant response.
- If snapshot loading fails, the cached transcript remains visible and
  streaming continues.
- Existing completed transcripts require no migration.

## Testing

Tests will be written before production changes.

### RuntimeBridge tests

- Published assistant events use the same ID as the persisted UI message.
- Start, delta, reasoning, and response events retain one ID.
- A subsequent response receives a different ID.

### Client reducer and reconciliation tests

- A background response remains one message after merging a server snapshot.
- Deltas received while a switch is in flight are retained exactly once.
- Repeated A-to-B and B-to-A switches do not duplicate the active response.
- Foreground transcript handling does not also run the background transcript
  reducer.
- Completed in-memory and refreshed transcripts have equivalent message IDs
  and text.

### Verification

- Run focused Web session, composer, bridge, and pool tests.
- Run `npm test`.
- Run `npm run build:web`.

## Success Criteria

During two concurrent sessions, switching between them at any point in a
stream:

- shows one assistant response bubble per response;
- never loses or repeats streamed text;
- continues updating the correct session;
- and produces the same transcript after completion and refresh.
