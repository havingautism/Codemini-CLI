# Small-project tool benchmark

Run from the repository:

```powershell
npm run bench:tools -- --out .scratch/tool-benchmark/current --check
```

This offline mode uses no model, credentials, external services or installed
project dependencies. It creates a fresh synthetic order-pricing project in a
temporary directory and cleans up only that exact generated directory. The
fixture generator is `scripts/benchmarks/tool-fixture.mjs`; the runner is
`scripts/bench-tools.mjs`. `--check` fails the command if a contract check fails.

## What it measures

The project contains two pricing/quantity defects, public tests, a README needing
a pricing explanation, a long source file, and a catalog with more than 100 paths.
The task requires a percentage discount before tax, positive safe-integer
quantities, documentation and passing tests.

Fourteen offline checks cover discovery, text search, grep/glob result budgets,
visible truncation, workspace-relative paths, complete reads, directory listing,
deferred schema activation without echo, error recovery, honest error feedback,
shell verification and final project acceptance. They exercise the real
ToolRuntime normalization/validation, handlers, formatters and persistence seam.
The scripted driver mirrors the agent loop's thrown-error prefix. It does not
measure whether a model chooses good calls.

Reports record per-call arguments, error messages, rendered result characters,
argument characters, visible schema characters and latency. Initial schema size
and cumulative result size are separate quantities. They are not tokenizer
measurements or dollar-cost estimates. Durations include index startup, filesystem
and shell startup; compare them cautiously.

Three platform profiles run the file-tool branches on the current test host. In
the Windows runs, all shell execution is still actual Windows PowerShell. This
does not boot Linux/macOS, Landlock, Seatbelt or a microVM. Sandbox policy coverage
remains in the dedicated sandbox and file-tool tests.

## Optional real-model task

Only opt in when model/API usage is intended:

```powershell
npm run bench:tools -- --live --out .scratch/tool-benchmark/live
```

This loads the current configured model, provider, endpoint and credential. Only
the synthetic project and default environment/tool guidance are sent. No original
workspace source, personal memories or user skill contents are supplied. The model
receives a controlled file-tool subset; other capabilities cannot be activated.
Shell execution is limited to `npm test` and `node --test test/*.test.js` in the
temporary project. Model steps are capped at 16, request timeout at 60 seconds and
total task timeout at 180 seconds. Gateway failures are recorded separately from
task acceptance. API credentials are not saved in reports.

Acceptance runs outside the model: it checks behavior with additional cases and
checksums the public tests, manifest and AGENTS.md. Editing a test to fake success
cannot pass. The provider's usage fields are retained when reported, including
cached input tokens. Character counts do not substitute for missing usage.

One task/run is a diagnostic sample, not a statistical model success rate. The
model may take different actions, generate different documentation or reuse a
different cache prefix. Do not infer end-to-end savings from smaller formatter
output alone.

## Before/after comparison

Capture the source or use separate checkouts **before** making a change. The
runner accepts an alternate tools module with `--tools-module path/to/tools.mjs`;
that module must export `getBuiltinTools` and have resolvable imports. In this
evaluation, the pre-follow-up `tools.js` snapshot lives in
`.scratch/tool-benchmark/baseline-tools.mjs`, with its relative imports rebased to
the repository source directory. Other runtime modules are shared, so this is a
tool-handler/formatter comparison, not a comparison of whole harness releases.

To emit a comparison with an existing run:

```powershell
npm run bench:tools -- --out .scratch/tool-benchmark/current --compare .scratch/tool-benchmark/before-live/results.json
```

Outputs are `results.json`, `REPORT.md`, and (with `--compare`) `COMPARISON.md`.
JSON retains traces so unexpected or worse results remain inspectable. The
evaluation's before/after live records and comparison are in
`.scratch/tool-benchmark/`; these synthetic artifacts contain no API key.

## Findings adopted in this follow-up

- Search, grep and glob now show truncation even when the returned window is
  smaller than the formatter's display limit. A capped result must not appear
  exhaustive.
- Linux/macOS grep and glob accept smaller `max_results` budgets; previously the
  handlers hard-coded 250 matches and 100 paths. Advertising these controls adds
  a small amount to their schemas while reducing large result windows.
- Windows glob paths from a scoped subdirectory are workspace-relative, matching
  the read tool's interpretation, rather than requiring the model to repair them.
- `tool_search` retains raw schemas for registry activation but returns a compact
  confirmation to the model. The next request already advertises the activated
  schema. Session persistence uses activated tool names, not the confirmation text.
- Error-only mutation/command results no longer format as `edited` or `exit: 0`.

The first real-model pair passed acceptance in both variants, but the follow-up
variant took more calls and reported more total input/output tokens. This is
recorded, not discarded. The repeatable evidence establishes the contract fixes
and fixed-trace output reduction; it does not establish cheaper whole tasks.

Regression coverage: `tests/tool-benchmark.test.js`, plus the existing tool-runtime,
Unix CRUD, read-window and write-contract suites. General runtime changes still
require `npm test`.
