# Browser diagnostics

`browser.enabled` defaults to false. With it off, browser tools are not registered and the CLI does not import `playwright-core`. Turn it on with `codemini config set browser.enabled true`, or the Web UI switch on the Web tab.

The tools are deferred. Load one with `tool_search` before calling it. One Chrome, Edge, or Chromium stays open for the session and is closed on shutdown. Playwright launches it with a temporary profile over its remote-debugging pipe. Do not point it at the user's daily profile. Chrome 136+ refuses remote debugging there anyway.

`playwright-core` does not download a browser. `browser.channel` is `auto`, `chrome`, `msedge`, or `chromium`. `auto` picks the first installed Chrome, then Edge, then Chromium. Set `browser.executable_path` to force a binary. An explicit missing path fails with `BROWSER_LAUNCH_FAILED` and does not fall back.

## Approval

Read-only tools are added to `execution.always_allow_tools`: `browser_snapshot`, `browser_screenshot`, `browser_logs`, `browser_explain_style`, `browser_listeners`, `browser_locate_source`.

These follow the normal approval flow: `browser_open`, `browser_navigate`, `browser_click`, `browser_type`, `browser_eval`, `browser_diagnose_click`, `browser_close`. In coding mode the plan tool list is auto-allowed, same as `edit` and `run`. Browser tools are not concurrency-safe.

## Targeting

Pass exactly one of `ref` (`@e1` from the latest `browser_snapshot`), `selector`, or `role` plus `name`. The JSON schema checks types, enums, and bounds. The handler checks the combination and returns `INVALID_TARGET` with a short recovery hint. Results are `{ ok, tool, summary, ... }` or `{ ok: false, tool, code, error }`.

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

`codemini doctor` reports a local Chrome, Edge, or Chromium. If browser tools are disabled and none is installed, that check is skipped.

## Desktop

`desktop/electron-builder.config.cjs` unpacks `**/node_modules/playwright-core/**` from the asar so the `ELECTRON_RUN_AS_NODE` server can import it. Debugging an Electron `webContents` page through `webContents.debugger` is not part of this version.

## Schemas

Every tool uses `type: function`, `additionalProperties: false`, and the `required` list below.

| Tool | Required | Notable enums and bounds |
| --- | --- | --- |
| `browser_open` | none | `channel`: chrome, msedge, chromium. `viewport_width` 320–3840, `viewport_height` 240–2160, `timeout_ms` 1000–120000 |
| `browser_navigate` | `url` | `wait_until`: commit, domcontentloaded, load, networkidle |
| `browser_snapshot` | none | `max_chars` 400–20000. `incremental` and `interactive_only` booleans |
| `browser_click` | none (target required by the handler) | `button`: left, right, middle. `click_count` 1–3. `timeout_ms` 200–30000 |
| `browser_type` | `text` | `delay_ms` 0–200. `clear` and `submit` booleans |
| `browser_eval` | `expression` | expression length 1–8000 |
| `browser_screenshot` | none | `format`: png, jpeg. `quality` 1–100 for jpeg |
| `browser_logs` | none | `since`: session, last_read. `kind`: all, console, exception, network. `level`: all, warning, error. `limit` 1–100 |
| `browser_close` | none | no properties |
| `browser_diagnose_click` | none (target required by the handler) | `observe_ms` 100–3000 |
| `browser_explain_style` | none (target required by the handler) | `properties` 1–20 names. `max_rules` 1–40 |
| `browser_listeners` | none (target required by the handler) | `types` 1–10 names. `max_listeners` 1–50 |
| `browser_locate_source` | none (target required by the handler) | same target fields |

Shared target fields: `ref` matching `^@e[1-9][0-9]*$`, `selector` (1–500), `role` (button, link, textbox, searchbox, checkbox, radio, combobox, switch, tab, menuitem, option, slider, heading, img, listitem, treeitem), and `name` (1–200).
