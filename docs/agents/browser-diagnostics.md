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
| `browser_inspect` | snapshot, screenshot, logs, explain_style, listeners, locate_source, assert | explain_style, listeners, and locate_source need one target. screenshot may take a target. assert requires `expect`. |
| `browser_act` | open, navigate, click, type, eval, close | navigate needs `url`. click and type need one target. type needs `text` or `clear:true`. eval needs `expression`. |
| `browser_diagnose` | click | one target, optional `expect`, and `observe_ms` 100–3000. |

Each tool declares only the fields its actions use. `browser_act` carries `channel` chrome|msedge|chromium, `wait_until` commit|domcontentloaded|load|networkidle, `button` left|right|middle, and viewport 320–3840 by 240–2160. `browser_inspect` carries snapshot, screenshot, log, style, and listener fields. `browser_diagnose` carries the target, `observe_ms` 100–3000, and `timeout_ms`. `ref` matches `^@e[1-9][0-9]*$`. The handler tightens `timeout_ms` per action.

## Business outcome checks

Use `browser_diagnose` to click once and wait for a page outcome in the same call.

```json
{"action":"click","selector":"#save","expect":{"state":"text","selector":"#result","value":"Saved"}}
```

Use `browser_inspect` with `action: "assert"` and the same `expect` after a fresh navigation to verify persistence without clicking again. `visible` and `hidden` take a CSS `selector`. `text` also takes a `value` and waits for a visible element containing that text. `url_path` takes a `value` matched against the URL pathname. When a result can already be present, choose a selector or text unique to the expected change.

The assertion has its own `timeout_ms` budget. For `browser_diagnose`, check `click.ok` and `assertion.ok` separately. The diagnostic result can contain evidence even when the assertion fails. A standalone failed assertion returns `ASSERTION_FAILED`.

The click probe tracks up to ten document, fetch, or XHR requests observed during the probe. An entry can be pending, responded, finished, or failed. A responded entry reports time to response headers. A finished or failed entry reports time to completion. HTTP errors still have an HTTP status. Network URLs omit user information, queries, and fragments. Request and response bodies are excluded. The default summary shows up to five request entries.
