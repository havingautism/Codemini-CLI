---
name: frontend-performance-profile
description: Collect a short browser performance report for jank, slow load, or scroll stalls, then inspect the mapped source. Use when a page is slow or a click, input, or scroll feels delayed.
version: 0.1.0
mode: agent_requested
---

# Front-end performance profiling

Use this when the question is why a page is slow or janky. Unclickable controls, wrong styles, and event handlers stay on `frontend-interaction-debug`.

`performance_profile` is not in the default tool list. Load it with `tool_search` before calling it. It runs in the same browser session as `browser_act`.

1. Call `performance_profile` with the page `url`, or omit `url` when that page is already open.
2. Pass `actions` that reproduce the stall: `click` or `type` with one `ref`, `selector`, or `role` plus `name`; `scroll` with `x` and `y`; `wait` with `duration`. At most 8 steps.
3. Leave `capture` unset unless you need only `trace`, `cpu`, or `metrics`. The default collects all three for about 2000ms.
4. Read `report.summary`, `report.longTasks`, and `report.hotspots`. `estimatedBlockingTime` is for this window only, not Lighthouse TBT. `selfTime` and `totalTime` are sampled estimates.
5. Open the mapped `source.file` around `source.line` with `read`. If `attribution` is `third-party` or `unmapped`, do not treat that frame as the app bug.
6. A long task or hotspot is a lead. Confirm it in the source before editing. Do not claim it is the root cause from the report alone.

Do not profile an Electron `webContents` page with this tool.
