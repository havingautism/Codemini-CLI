# Scheduled tasks

The Web sidebar's **Scheduled tasks / 定时任务** page manages durable tasks and their latest 100 run records. Each run creates a fresh session with a fixed prompt, project directory, and daily (`normal`) or coding (`plan`) mode. It uses the configured provider/model and the normal Soul, project, skills, memory, and permission machinery. Task mode does not update the user's global execution-mode preference.

## Scheduling and background lifecycle

- Supports one-time timestamps, whole-minute intervals, daily times, and selected weekdays. Daily/weekly schedules store an explicit IANA timezone; one-time timestamps store an absolute instant.
- Daily/weekly schedules follow local wall-clock time. Missing times during a daylight-saving transition are skipped. A claimed local date is excluded from the next occurrence, so a repeated DST hour does not cause a second run that day.
- Tasks and run snapshots live in the global SQLite database (schema 20). Creation, edits, pause/resume, and due-run claims are transactional. Queued runs keep the task definition they were created with.
- A detached, hidden Node process runs tasks independently of the browser and Web server. Creating/enabling a task, requesting a manual run, opening Web with pending work, or `codemini schedule start` starts it. No new package or OS service is installed.
- A SQLite lease elects one worker per global data directory. It renews every 10 seconds with a 90-second lease. Each task has at most one queued/running execution; the worker executes runs serially. Idle release and pending-work checks share one transaction to avoid losing a just-queued run.
- Closing the browser or Web server does not stop this worker. The computer must remain awake/on and have access to the configured provider. After reboot, open Web or run `codemini schedule start`; automatic OS-login startup is not installed.
- After downtime, an overdue task runs once. Repetitions missed during downtime are coalesced, and the next occurrence is calculated after the actual claim time. A late one-time task runs once, then disables itself.
- Pausing affects future scheduled claims. An already queued/running execution continues. Deletion is refused until queued/running executions finish; deletion removes the task and run records, retaining the generated chat sessions.
- After a worker crash or force termination, a replacement can start after the old lease expires. It marks abandoned executions interrupted and does not automatically replay partially executed work. Start the worker from Web or the CLI if it stopped unexpectedly. Diagnostics are in `<global-config-dir>/scheduled-worker.log`.

## Permissions and sessions

Background runs preserve the existing approval policy. An actual tool-approval request is denied, the active turn is aborted in place, and the run is marked **Needs attention / 待处理**. A user-input request follows the same path. Open the generated session and continue interactively; no unattended approval is granted by this feature.

The Web runtime refuses to load/write/delete a session while its scheduled run is actively writing it. Chat links in the task page become available after the run finishes, fails, or needs attention. This prevents concurrent Web/background writers from overwriting the same transcript. Other interactive sessions continue normally.

The first version does not provide forced cancellation of a running background task, cron-expression entry, automatic retry after ambiguous partial execution, OS-login startup, or external notifications. Results and actionable errors appear in the task page and its generated sessions.

## Entry points

- `src/core/task-schedule.js`: validation and timezone-aware next occurrence.
- `src/core/scheduled-task-store.js`: tasks, run snapshots, atomic claims, worker lease.
- `src/core/scheduled-worker.js`: execution and worker loop.
- `src/core/scheduled-worker-process.js`: detached process startup.
- `src/commands/schedule.js`: `codemini schedule start|status`.
- `codemini-web/lib/scheduled-task-api.js`: authenticated task-management routes (the ordinary Web security layer runs first).
- `codemini-web/client/src/components/ScheduledTasksPanel.jsx`: task editor, lifecycle controls, run records.

## Verification

### Web library layout (2026-11-01)

The task library follows the Scrapbook and Deep Research pages: a full-width toolbar with filters/search, grid/list views, sorting, a library title/count, and tinted cards with a separate actions menu. Task colors are stable across sorting. Run history has its own filter entry; opening a task loads that task's own recent records rather than filtering only the global latest 100 records.

Creation, editing and task details use the existing Dialog components. Background status stays compact, with operational details in a help popover. Mobile and collapsed-sidebar navigation use the same top bar as Scrapbook/Research. Completed one-time tasks show completed rather than paused; expired one-time tasks offer Reschedule, which opens an editable future-time proposal before saving. Editing other fields preserves an unchanged one-time instant, including seconds and DST ambiguity.

UI helpers, scoped API requests and existing scheduler regressions passed 22/22; the Web build and source design scan passed. Windows browser automation could not reliably identify its current URL and stopped, so rendered desktop/mobile appearance and pointer/keyboard interactions remain unverified.

Use `node scripts/run-tests.js tests/scheduled-tasks.test.js tests/scheduled-worker-web.test.js tests/sqlite-storage.test.js tests/runtime-pool.test.js`, `npm test`, and `npm run build:web`.

The integration test starts an isolated Web server and local simulated model, creates a task through HTTP, terminates that Web server before the due time, and verifies completion by the detached worker. It also verifies coding/daily prompt separation, unchanged global mode, single-run semantics under concurrent worker starts, stopping for user input, and refusing a tool approval without modifying its sentinel file. No real provider or real user's task configuration is used.

2026-10-31 verification: the focused storage/runtime/UI/API group passed 29/29, the latest execution-specific group passed 10/10, and the Web build passed. The full-suite snapshot was 1466 passed, 6 failed, 5 skipped. Five failures match the earlier welcome/disclosure, Crew events/review, and shell-wrapper failures; the additional terminal resize assertion is timing-sensitive (it passed in the preceding full run). This is not a clean full-suite result. Source UI scanning reported no findings; rendered browser verification could not run because the in-app browser's loopback connection timed out.


### Workspace and timezone pickers (2026-11-02)

The editor uses a shared Radix Popover + cmdk searchable selector. Project choices include active sidebar projects, the saved project (even if no longer active), an explicit general workspace, and a Browse action. Browsing reuses ProjectSelector without opening or switching the current chat. Explicitly saving an empty project now resets an edited task to the general workspace; omitted project fields retain the previous directory.

ProjectSelector is shared with Add Project: root locations are clickable, typed paths navigate on Enter, folder names can be filtered, and selecting the current directory requires a separate confirmation. Loading/errors are visible, unavailable paths cannot be confirmed, and stale navigation responses are discarded. Parent navigation handles Windows drives, UNC shares, and POSIX roots.

Timezones come from Intl.supportedValuesOf with common/local/current fallbacks, translated names, current UTC offsets, IANA identifiers, and common Chinese city keywords. Saved values remain IANA zones, so scheduling still observes DST.

Verification: 26/26 focused tests and Web build passed. Browser checks passed for Chinese city search, Enter selection without submitting, directory navigation/confirmation, invalid-path recovery, project backfill, and desktop/390px layout. Full suite: 1493 tests, 1480 passed, 8 failed, 5 skipped; failures were in chat-empty-state, crew-events, crew-mode, crew-review, web-disclosure-tree, web-terminal (2), and write-coordinator, outside the changed picker behavior.
