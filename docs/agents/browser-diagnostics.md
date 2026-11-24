# Browser diagnostics

`browser.enabled` defaults to false. With it off, browser tools are not registered and the CLI does not import `playwright-core`. Turn it on with `codemini config set browser.enabled true`, or the Web UI switch on the Web tab.

The tools are deferred. Load one with `tool_search` before calling it. One Chrome, Edge, or Chromium stays open for the session and is closed on shutdown. Playwright launches it with a temporary profile over its remote-debugging pipe. Do not point it at the user's daily profile. Chrome 136+ refuses remote debugging there anyway.

`playwright-core` does not download a browser. `browser.channel` is `auto`, `chrome`, `msedge`, or `chromium`. `auto` picks the first installed Chrome, then Edge, then Chromium. Set `browser.executable_path` to force a binary. An explicit missing path fails with `BROWSER_LAUNCH_FAILED` and does not fall back.

## Approval

Read-only tools are added to `execution.always_allow_tools`: `browser_snapshot`, `browser_screenshot`, `browser_logs`, `browser_explain_style`, `browser_listeners`, `browser_locate_source`.

`browser_act` and `browser_diagnose` follow the normal approval flow. Coding mode auto-allows the whole plan tool list, which already includes `edit` and `run`, so those two browser tools are auto-approved there too. Review mode still prompts because they are not in `always_allow_tools`. Browser tools are not concurrency-safe.

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

Each tool is `type: function`, `additionalProperties: false`, and requires `action`. Providers here do not reliably honor `oneOf`, so the schema is flat. The handler checks the fields for the chosen action and returns `INVALID_ARGUMENTS` naming them.

| Tool | Actions | Fields the action needs |
| --- | --- | --- |
| `browser_inspect` | snapshot, screenshot, logs, explain_style, listeners, locate_source | explain_style, listeners, and locate_source need one target. screenshot may take a target. |
| `browser_act` | open, navigate, click, type, eval, close | navigate needs `url`. click and type need one target. type needs `text` or `clear:true`. eval needs `expression`. |
| `browser_diagnose` | click | one target. `observe_ms` 100–3000. More probe actions can be added on this tool. |

Shared bounds stay on the flat schema: `channel` chrome|msedge|chromium, `wait_until` commit|domcontentloaded|load|networkidle, `format` png|jpeg, `button` left|right|middle, viewport 320–3840 by 240–2160, `timeout_ms` 200–120000 (the handler tightens this per action), `ref` matching `^@e[1-9][0-9]*$`. Target fields are `ref`, `selector`, `role`, and `name`.
