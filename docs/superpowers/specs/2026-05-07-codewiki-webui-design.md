# CodeWiki WebUI Design

Date: 2026-05-07

## Goal

Add a CodeWiki-style view to the WebUI that lets users generate and browse the current project's `project-requirements` report from inside the app.

The first version should feel similar to Code Wiki: a left wiki/navigation rail, a central report surface with diagrams and requirements content, and a right repository Q&A panel. It should reuse the existing `project-requirements` skill and current chat runtime rather than creating a separate report engine.

## Scope

In scope:

- Add a CodeWiki entry to the existing WebUI sidebar.
- Add a `codewiki` app view beside the existing `chat` and `sessions` views.
- List existing `docs/requirements/*-project-requirements.html` reports for the current project.
- Trigger report generation through the existing `/project-requirements` command path.
- Display the selected report in the central panel through a safe backend route.
- Provide a right-side question box that submits to the current chat runtime with CodeWiki context.
- Keep the first version responsive enough to remain usable on narrower screens.

Out of scope for the first version:

- Parsing the HTML report into native React sections.
- Producing or consuming a JSON report format.
- Creating a dedicated CodeWiki chat session store.
- Rewriting the `project-requirements` generation contract.
- Importing remote GitHub repositories by URL.

## User Experience

The WebUI sidebar gains a `CodeWiki` item. Selecting it opens a three-column workspace:

- Left rail: project name, generation action, report list, and simple section shortcuts.
- Center: selected report rendered inside an iframe-like document surface.
- Right rail: repository question panel that reuses the current chat runtime.

If no report exists, the center panel shows an empty state with a primary action to generate a report.

If a report exists, the newest report is selected by default. Users can switch older reports from the left rail.

When generation starts, the view shows a running state and sends `/project-requirements` through the existing runtime. When the runtime completes, the WebUI refreshes the report list and opens the newest report.

When the user asks a CodeWiki question, the WebUI submits a prompt to the existing chat runtime:

```text
请基于当前项目的 CodeWiki / project-requirements 报告回答这个问题：<question>
```

The current chat stream remains the source of truth for assistant output, tool calls, and approvals. The CodeWiki right rail shows the latest submitted question and a compact status state while the main runtime answers.

## Backend Design

Add CodeWiki endpoints to `codemini-web/server.js`:

- `GET /api/codewiki/reports`
  - Reads `docs/requirements` under `currentProjectDir`.
  - Returns HTML reports matching `*-project-requirements.html`.
  - Sorts newest first using file mtime.
  - Includes file name, size, mtime, and a display title.

- `GET /api/codewiki/report/:file`
  - Serves a selected HTML report from `currentProjectDir/docs/requirements`.
  - Rejects path traversal and files outside the requirements directory.
  - Only serves `.html` files that match the project requirements report naming pattern.

- `POST /api/codewiki/generate`
  - Submits `/project-requirements` to the existing `RuntimeBridge`.
  - Returns `{ ok: true }` after submission, not after full generation.
  - Rejects if the runtime is currently busy.

The generation endpoint intentionally uses the same runtime pathway as the chat input so skill events, tool activity, approvals, and session persistence stay consistent.

## Frontend Design

Add CodeWiki API helpers in `codemini-web/client/src/hooks/use-api.js`:

- `fetchCodeWikiReports()`
- `generateCodeWikiReport()`

Add `CodeWikiPanel.jsx`:

- Loads report list on mount and after generation completes.
- Selects the newest report by default.
- Displays generation/loading/error states.
- Embeds selected report through `/api/codewiki/report/<encoded-file>`.
- Provides a right rail question form that calls `actions.submit()` with the CodeWiki prompt prefix.

Update app state in `app-context.jsx`:

- Add `currentView: "codewiki"` support.
- Add route parsing for `/codewiki`.
- Use `actions.switchView("codewiki")` for navigation.
- Refresh reports when a `submit:done` event follows CodeWiki generation.

Update `App.jsx`:

- Render `CodeWikiPanel` when `state.currentView === "codewiki"`.
- Pass `projectCwd`, `busy`, and `actions.submit`.

Update `Sidebar.jsx`:

- Add a CodeWiki item using an existing lucide icon such as `BookOpenText` or `Map`.
- Highlight it when the current view is CodeWiki.

## Visual Direction

The first version should match the current WebUI's quiet dark/light application shell rather than copying Code Wiki exactly. It should borrow the functional layout:

- Three-column workspace.
- Report surface as the dominant center object.
- Compact left navigation.
- Right Q&A panel.

The design should avoid decorative hero content. It is a work surface for understanding the current project.

## Error Handling

- If `docs/requirements` does not exist, return an empty report list.
- If report generation starts while the runtime is busy, return a conflict response and show a short message.
- If a selected report disappears, clear selection and reload reports.
- If the iframe report fails to load, show a retry action.
- If report generation completes without producing a report, show a message explaining that no report was found and leave the generate action available.

## Security

- Report serving must resolve and compare real paths under `currentProjectDir/docs/requirements`.
- The report endpoint must reject `..`, absolute paths, and non-matching file names.
- The iframe should use a restrictive `sandbox` attribute. The current report is self-contained and should not need top-level navigation or form submission.

## Testing

Manual verification:

- Open WebUI and switch between Chat, Sessions, and CodeWiki.
- With no requirements report, CodeWiki shows an empty state.
- Generate a report and verify the existing runtime handles the skill invocation.
- After generation, refresh the report list and open the newest report.
- Ask a question from the CodeWiki right rail and verify it submits to chat with the CodeWiki context prefix.
- Try a malformed report URL and verify the server rejects it.

Automated or targeted checks:

- Add lightweight backend tests if the repo has a convenient server test harness.
- Run the WebUI build/lint command available in `codemini-web/package.json`.
