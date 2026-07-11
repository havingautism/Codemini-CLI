# Status Bar Model Synchronization Design

## Problem

The Web UI status bar displays `runtimeState.model`. After `model.name` is
changed in Settings, the server currently reloads configuration only on the
bridge referenced by the current request handler. Other loaded sessions retain
their previous runtime-pool `model` value. Switching to one of those sessions
hydrates the client from the stale pool snapshot, so some status bars show the
new model while others show the old model.

## Expected Behavior

Saving `model.name` updates every loaded Web UI session to the configured model.
Each session's status bar and its subsequent model requests must agree. Switching
between sessions must not restore a stale model label.

Sessions that are not loaded do not need eager initialization. When loaded later,
they continue to use the current configuration through the existing runtime
factory behavior.

## Design

Add a focused runtime-pool operation that reloads configuration for every loaded
session bridge. When a model is supplied, the operation also updates each pool
entry's `model` field after that bridge reload succeeds and emits a fresh pool
state for the entry.

The `/api/config/set` handler will use this pool-wide operation after saving
`model.name`. Other configuration keys will still be reloaded across loaded
runtimes so their in-memory configuration remains current, matching the intent
of the existing reload call. Runtime-state broadcasts will continue to notify
the active client state, while pool-state broadcasts keep per-session cached
state synchronized.

The update is server-owned rather than a display-only client override. This
ensures the status bar represents the model the runtime will actually use.

## Failure Handling

The pool-wide reload waits for all loaded bridges. If any reload fails, the
configuration endpoint returns an error through its existing error path rather
than reporting a successful partial synchronization. Pool entry model metadata
is updated only after its corresponding bridge reload succeeds.

## Testing

Add a runtime-pool regression test with multiple loaded session bridges. Verify
that a pool-wide reload:

- calls `reloadConfig` for every loaded bridge;
- updates every session snapshot to the new model;
- emits updated state so clients can refresh cached session runtimes.

Run the focused runtime-pool tests, the full test suite, and `npm run build:web`.

