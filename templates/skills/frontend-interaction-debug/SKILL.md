---
name: frontend-interaction-debug
description: Locate why a front-end control is not clickable, which CSS rule wins, which event handler runs, and which workspace file and line it comes from. Use for button, link, or input bugs in a browser.
version: 0.1.0
mode: agent_requested
---

# Front-end interaction debugging

Use this when a control does the wrong thing, cannot be clicked, or is styled by an unexpected rule. These tools are available in coding mode only. They are not in the default tool list: load `browser_inspect`, `browser_act`, or `browser_diagnose` with `tool_search` before calling it. Pass `action`, and target an element with exactly one of `ref` (`@eN`), `selector`, or `role` plus `name`.

1. `browser_act` `action:"open"` with the page URL. The browser uses a temporary profile.
2. `browser_inspect` `action:"snapshot"`. Interactive elements get stable `@eN` refs. Prefer a ref for later calls.
3. If a click does nothing, `browser_diagnose` `action:"click"` on that ref. Read `hit.reason`:
   - `occluded` means another element is on top. The chain names it.
   - `pointer-events-none` means the target ignores the pointer.
   - `disabled` means the control is disabled or `aria-disabled`.
4. If color, visibility, or stacking looks wrong, `browser_inspect` `action:"explain_style"`. `computed` is the used value. `winning` is the rule that owns it. `overridden` lists declarations that lost.
5. To see which function runs, `browser_inspect` `action:"listeners"`. `location.file` and `location.line` are workspace coordinates when a source map resolves.
6. To see which component rendered the node, `browser_inspect` `action:"locate_source"`. React 18 uses `_debugSource`. React 19 uses `_debugStack` plus the source map. Vue 3 uses `__vueParentComponent.type.__file`.
7. `browser_inspect` `action:"screenshot"` writes a file path. `action:"logs"` returns console errors, exceptions, and failed network entries.
8. `browser_act` `action:"close"` when you are done.

In coding mode, `browser_inspect`, `browser_act`, and `browser_diagnose` are auto-approved on the same list as `edit` and `run`.

`browser_diagnose` currently has one probe, `click`. More probe actions can be added without a new tool.

Do not debug an Electron `webContents` page with these tools.
