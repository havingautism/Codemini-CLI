---
name: incremental-implementation
description: Use when implementing multi-file changes, non-trivial features, refactors, or any change likely to exceed one small edit; builds in thin verified slices
---

# Incremental Implementation

Build one logical slice at a time. Each slice should leave the repo understandable and testable.

## When to Use

- Multi-file implementation
- Feature work from a plan or spec
- Refactoring with behavior preservation
- Any change where more than about 100 lines may be written before feedback

## Slice Cycle

1. **Choose one slice** - One behavior, boundary, or mechanical step.
2. **Limit scope** - Name the expected files, acceptance condition, verification command, and what is intentionally out of scope.
3. **Implement** - Prefer the simplest correct version. Do not add speculative abstraction.
4. **Verify** - Run the focused test/build/check that proves this slice.
5. **Inspect diff** - Confirm the diff matches the slice and contains no unrelated cleanup.
6. **Continue** - Move to the next slice only after the current slice is stable or clearly blocked.

## Slicing Guidance

- Prefer vertical slices when a user-visible path can be completed end-to-end.
- Prefer contract-first slices when frontend/backend or CLI/runtime boundaries are involved.
- Prefer risk-first slices when one unknown could invalidate the design.
- Treat setup, fixtures, and docs as part of the slice whose deliverable needs them.
- Split only where one slice can be reviewed, accepted, or rejected independently.

For each slice, be able to answer: what changed, how it is proven, what it consumes from earlier work, and what later work depends on.

## Slice Self-Review

Before moving to the next slice, check:

- Requirement coverage: this slice satisfies the acceptance condition it claimed.
- Naming consistency: paths, functions, types, commands, and user-facing names match the spec or previous slices.
- No placeholders: comments, docs, and tests do not contain deferred decisions disguised as implementation.
- Verification fit: the focused check proves the slice, and any broader final check remains explicit.

## Red Flags

- Multiple unrelated concerns in one edit
- Broad refactors bundled with behavior changes
- New abstraction for a single use
- Tests deferred until the end
- Touching generated output or adjacent files without need
- Moving to the next slice while current outputs are unnamed or unverified
- "Similar to previous slice" notes instead of concrete implementation details

## Exit Criteria

- Each slice has a focused diff and verification result.
- Remaining work is explicit.
- The final summary separates completed behavior, verification, and known gaps.
