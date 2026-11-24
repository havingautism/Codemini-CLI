# Browser diagnostics

The three browser tools are available in coding mode only. Everyday/normal mode does not register them. Even in coding mode they stay out of the default tool list: they live in the deferred catalog and load through `tool_search`. `playwright-core` is imported on the first browser launch, not at CLI startup. `web_fetch` uses that same launcher for JavaScript pages: system Chrome or Edge, then an already installed Playwright Chromium when those are missing.

One Chrome, Edge, or Chromium stays open for the session and is closed on shutdown. Playwright launches it with a temporary profile over its remote-debugging pipe. Do not point it at the user's daily profile. Chrome 136+ refuses remote debugging there anyway.

`playwright-core` does not download a browser. `browser.channel` is `auto`, `chrome`, `msedge`, or `chromium`. `auto` picks the first installed Chrome, then Edge, then Chromium. Set `browser.executable_path` to force a binary. An explicit missing path fails with `BROWSER_LAUNCH_FAILED` and does not fall back.

## Approval

Coding mode auto-allows the whole plan tool list, which already includes `edit` and `run`. `browser_inspect`, `browser_act`, and `browser_diagnose` are on that list, so they are auto-approved in coding mode. Browser tools are not concurrency-safe.

## Targeting

Pass exactly one of `ref` (`@e1` from the latest `browser_inspect` snapshot), `selector`, or `role` plus `name`. The JSON schema checks types, enums, and bounds. The handler checks the combination and returns `INVALID_TARGET` with a short recovery hint. Results are `{ ok, tool, summary, ... }` or `{ ok: false, tool, code, error }`.

`locate_source` uses framework debug metadata (React 18 `_debugSource`, React 19 `_debugStack`, Vue `__file`) and sourcemaps. Relative map URLs resolve from the generated script, including minified scripts. When verified workspace sources are available, the result lists those files under `workspaceSource`. Use `edit` on the relevant source, then `run` with the project's build command. If only browser locations are available, use a dev build with sourcemaps.

`logs` includes the first application stack frame for each exception when available. Use its URL, line, and column to inspect the compiled script before mapping it back to source.

`listeners` reports DOM listeners. On React 17+ a click listener is the root delegate in `react-dom`, so its location is not the component `onClick`. Use `locate_source` for the component.

## Tests

Schema and result-shape tests always run:

```bash
node --test tests/browser-tools.test.js
```

Page tests need a local Chrome, Edge, or Chromium and built fixtures:

```bash
node tests/fixtures/browser/build.mjs
CODEMINI_BROWSER_TESTS=1 node --test --test-concurrency=1 tests/browser-diagnostics.test.js
```

`codemini doctor` reports a local Chrome, Edge, or Chromium. If none is installed, that check is skipped.

## Desktop

`desktop/electron-builder.config.cjs` unpacks `**/node_modules/playwright-core/**` from the asar so the `ELECTRON_RUN_AS_NODE` server can import it. Debugging an Electron `webContents` page through `webContents.debugger` is not part of this version.

## Schemas

Each tool is `type: function`, `additionalProperties: false`, and requires `action`. Providers here do not reliably honor `oneOf`, so the schema is flat. The handler checks the fields for the chosen action and returns `INVALID_ARGUMENTS` naming them.

| Tool | Actions | Fields the action needs |
| --- | --- | --- |
| `browser_inspect` | snapshot, screenshot, logs, explain_style, listeners, locate_source | explain_style, listeners, and locate_source need one target. screenshot may take a target. |
| `browser_act` | open, navigate, click, type, eval, close | navigate needs `url`. click and type need one target. type needs `text` or `clear:true`. eval needs `expression`. |
| `browser_diagnose` | click | one target. `observe_ms` 100–3000. More probe actions can be added on this tool. |

Each tool declares only the fields its actions use. `browser_act` carries `channel` chrome|msedge|chromium, `wait_until` commit|domcontentloaded|load|networkidle, `button` left|right|middle, and viewport 320–3840 by 240–2160. `browser_inspect` carries snapshot, screenshot, log, style, and listener fields. `browser_diagnose` carries the target, `observe_ms` 100–3000, and `timeout_ms`. `ref` matches `^@e[1-9][0-9]*$`. The handler tightens `timeout_ms` per action.
