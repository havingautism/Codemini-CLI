# File tools: continuous reads and compact feedback

`src/core/read-window.js` owns the text window used by Windows, Linux and macOS,
including host, OS sandbox and microVM configurations. File tools run through the
existing workspace path checks; shell sandbox execution remains separate.

## Change ownership

The per-turn file overview and undo checkpoints record explicit file-tool targets
from their worktree state immediately before the operation. They do not scan Git
status or use HEAD as a substitute for a missing pre-operation snapshot. Existing
manual edits and unrelated files changed by another session stay outside the operation.
Patch moves capture both the source and destination.

Shell commands cannot establish file ownership from directory differences alone:
another process can edit files while a command runs. Consequently shell-only
changes are not included in the per-turn overview or its undo checkpoints. Use
file mutation tools for changes that need those records. Concurrent edits to the
same explicitly targeted file still require the tools' observation/conflict guards;
this checkpoint layer is not process-level filesystem tracing.

## Read contract

- A normal read defaults to at most 2000 consecutive lines and 50 KiB of numbered
  output. Smaller positive `context.read_file_default_lines` and
  `context.read_file_max_chars` settings remain effective. Existing configurations
  explicitly storing the old 120/12000 values are not silently rewritten.
- `offset` is 1-based and `limit` is a positive line count. Legacy Windows
  `start_line`/`end_line`, inline `path:10-40`, and path aliases remain accepted.
  Explicit invalid ranges and zero limits fail instead of looping on an empty page.
- Limits stop at whole-line boundaries. Results expose the actual range,
  `total_lines`, `truncated`, and `next_offset`; the model gets a continuation hint.
  Lines longer than 2000 UTF-16 code units have an explicit truncation marker.
  An explicitly smaller character budget can also shorten the first line so the
  call always makes progress. Shortened lines cannot be recovered by line pagination;
  search for specific content in such files.
- Streaming bounds the current line and result memory. The file is scanned to
  count lines and hash its exact bytes; the same hash records the observed version,
  avoiding another full-file read. UTF-8 decoding survives chunk boundaries.
- Blank lines keep their line numbers. CRLF is displayed as LF. Binary files are
  rejected by this text reader. Empty files return an explicit empty-file header.
- Explicit rereads return content, even when the file is unchanged. An earlier
  result may have been compacted out of context; mtime-based stubs cannot prove
  that the model still has its contents.
- AST reads have the same output limits and file-relative continuation offsets.
  Continue a large selection with ordinary `read` on its file and offset.
  AST reads also authorize their path and record an observed version.

`tools.js` formats these windows once. `agent-loop.js` recognizes their
`bounded_read` flag and does not replace them with the generic disk preview.
Other large tool results still use `tool-result-store.js`.

## Write and edit contract

Use `edit` for localized changes and `write` for whole-file content. Windows keeps
its explicit `overwrite=true` requirement and staged-write tools. Existing sandbox
approval, backup, file locks and platform-specific observation policies remain in
place. Windows edit/write now use the same atomic-write helper as Linux/macOS.

Successful edit/create/write responses contain the operation and path (plus a
changed line for edits), without echoing the generated code or diff. Structured
diffs and backups remain available to the UI and review pipeline. Missing-text
errors show a small relevant excerpt when possible, or note that the replacement
may already be present. Ambiguity errors list at most eight short match excerpts.

### Write-side harness comparison

The follow-up write audit uses [OpenCode write](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/tool/plugin/write.ts),
[OpenCode mutation mechanics](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/file-mutation.ts),
[DeepSeek patch guidance](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/fs/tool-fs/src/apply-patch.ts)
and [DeepSeek atomic publication](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/fs/fs-local/src/fsio.ts).
The adopted principles are simple common operations, explicit unique edits,
preflight before mutation, compact model feedback and truthful partial results.

- `write` and staged commits no longer duplicate their diffs or content hashes in
  model feedback. `apply_patch` reports a count and at most 20 short paths; full
  paths, diffs and hashes remain in structured results. Optional commit hashes are
  intended for precomputed values from tooling, not for the model to guess.
- Exact replacements require an explicit replacement string (empty is deletion)
  and reject identical old/new text on all platforms.
- `atomicWriteUtf8` exclusively creates a private temporary file, writes and syncs
  it, preserves existing POSIX permission bits, then publishes in the same
  directory. New-file publication uses a no-replace hard link, so a concurrent
  creator is preserved. Filesystems without hard-link support fail rather than
  silently falling back to overwriting. Only a temporary file created by that
  invocation is cleaned up. New POSIX files use owner-only permissions.
- `apply_patch` checks every source and move destination through the same sandbox
  write boundary as ordinary edits, including explicit escalation approval.
  Occupied move destinations and repeated target sections are rejected in
  preflight. Combine separated hunks for a file in one `Update File` section.
- Patch `End of File` markers constrain matching to the file end. Added files
  receive a final newline. Each written file is published atomically; the whole
  multi-file patch is **not** a transaction. An I/O failure after publication
  returns `ok=false`, an error, the known affected `files`, and `failed_path`.
  Pending files are not recorded as successfully observed. Inspect affected files
  before retrying a partially applied patch.

Availability retains the existing platform contract: Windows exposes staged
writes and `apply_patch`; Linux/macOS expose the minimal write/edit surface.
The shared handler policy is tested for all three platforms. This change does
not add DeepSeek's native Windows DACL-copy/ReplaceFile mechanism or a cross-file
rollback guarantee. POSIX mode preservation needs a native POSIX test run.

`tests/write-tool-contract.test.js` covers write-side failures, patch sandbox
checks, collision protection, EOF matching, partial application and compact
feedback. Its executable-mode assertion is skipped on a Windows host.

Model-facing tool definitions advertise canonical search arguments. Runtime
normalization keeps legacy aliases. Known paths can be read directly; search
locations suggest a context window rather than just the matching line.

## Design references and verification

For the repeatable small-project benchmark, real-model traces and measurement
limits, see [tool-benchmark.md](tool-benchmark.md). Run `npm run bench:tools -- --check`
for the offline contract evaluation; model/API use requires explicit `--live`.

Compared with the public development sources on 2026-11-04:

- [OpenCode read](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/tool/plugin/read.ts)
  and [windowing](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/tool/read-filesystem.ts):
  sufficient contiguous reads, numbered lines and explicit continuation.
- [OpenCode edit](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/tool/plugin/edit.ts):
  useful failure context and newline compatibility.
- [DeepSeek file tools](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/fs/tool-fs/README.zh.md):
  bounded reads and compact mutation feedback.

Against the pre-change definitions, serialized `read`/`edit`/`write`/`search_code`
schemas decreased from 8058 to 6325 characters on Windows (21.5%) and 4183 to 3293
on Linux/macOS (21.3%), with default configuration. A representative edit response
with a long diff decreased from 633 to 32 characters. These are character counts,
not provider token counts or a claim of lower total task cost: a complete read
necessarily sends more source than the former incomplete preview.

`tests/read-window.test.js` checks numbered windows, caps, Unicode/CRLF, rereads,
AST continuation and actual agent-loop wire content. Its cross-platform matrix
exercises file-tool policy branches on the test host; it does not boot microVMs or
constitute native Linux/macOS sandbox acceptance.

Run `npm test` for runtime verification. Where local HTTP fixtures are blocked by
the execution environment, rerun on a host with loopback access; do not classify
those failures as product regressions without checking their cause.
