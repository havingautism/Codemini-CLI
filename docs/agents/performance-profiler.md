# Performance Profiler

`performance_profile` is a coding-mode deferred tool. Load it with `tool_search`. It reuses the same Chromium page and CDP session as `browser_act`. Playwright reproduces the interaction. Tracing, the CPU profiler, and Performance metrics stay separate evidence channels. Node returns a short report. The raw trace and profile are not sent to the model.

Tracing answers what the browser did. The CPU profiler answers where sampled JavaScript time went. A hotspot or long task is a lead, not a confirmed root cause.

`estimatedBlockingTime` is `max(0, taskMs - 50)` summed over complete main-thread tasks in the requested window. It is not Lighthouse total blocking time. CPU self time and total time are sampled estimates.

Long tasks prefer complete `RunTask` events (`ph: "X"`, duration in microseconds). An event named `LongTask` is used only when the trace actually contains it. Nested events inside a kept task are not added again.

Click and type use the same ref, selector, or role-plus-name locator as `browser_act`. Scroll is a mouse wheel (`x`, `y`). One session runs one profile at a time.

The skill is `frontend-performance-profile`. Interaction bugs still use `frontend-interaction-debug`.
