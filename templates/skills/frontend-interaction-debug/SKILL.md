---
name: frontend-interaction-debug
description: Locate why a front-end control is not clickable, which CSS rule wins, which event handler runs, and which workspace file and line it comes from. Use for button, link, or input bugs in a browser.
version: 0.1.0
mode: agent_requested
---

# Front-end interaction debugging

Use this when a control does the wrong thing, cannot be clicked, or is styled by an unexpected rule. Browser tools stay deferred until you load them, and they only exist when `browser.enabled` is true.

1. Load the tools you need with `tool_search`. Start with `browser_open`, then `browser_snapshot`.
2. Target the control with the `@eN` ref from the snapshot. Use a CSS selector or `role` plus accessible `name` only when you do not have a ref, and pass only one of those.
3. If the click does nothing or the wrong element receives it, call `browser_diagnose_click`. Read `hit.reason`:
   - `occluded` means another element is on top. The chain names that element.
   - `pointer-events-none` means the target ignores the pointer.
   - `disabled` means the control is disabled or `aria-disabled`.
4. If the color, visibility, or stacking looks wrong, call `browser_explain_style`. `computed` is the used value. `winning` is the rule that owns it. `overridden` lists the declarations that lost.
5. To see which function runs, call `browser_listeners`. `location.file` and `location.line` are workspace coordinates when a source map resolves.
6. To see which component rendered the node, call `browser_locate_source`. React 18 uses `_debugSource`. React 19 uses `_debugStack` or `_debugInfo` plus the source map. Vue 3 uses `__vueParentComponent.type.__file`.
7. `browser_screenshot` writes a file path. `browser_logs` returns console errors, exceptions, and failed network entries.
8. Close with `browser_close` when you are done. The browser uses a temporary profile, not the user's daily Chrome profile.

Read-only tools do not need approval. `browser_open`, `browser_navigate`, `browser_click`, `browser_type`, `browser_eval`, `browser_diagnose_click`, and `browser_close` follow the normal approval flow.

Do not debug an Electron `webContents` page with these tools. That path is not part of this version.
