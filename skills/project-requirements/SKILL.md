---
name: project-requirements
description: Generate an interactive project requirements report from an existing codebase. Use when the user asks for a PRD, requirements document, API-by-API breakdown, business flow, architecture map, dependency graph, flowchart, product requirements reverse-engineering, or detailed project demand analysis.
version: 0.1.0
---

Use this skill to reverse-engineer a project into a requirements document that product, engineering, and QA can navigate.

Default to an HTML report with lightweight interactions. Produce Markdown only when the user asks for a text-first artifact, a PR-friendly source document, or an additional companion file.

User request:

```text
{{args}}
```

Honor any concrete user request above, such as output format, report path, focus area, API subset, diagram style, or language. If it is empty, generate the default HTML requirements report for the current workspace.

Follow the active reply language from the system prompt for all generated report prose, user-facing labels, placeholder text, summaries, comments, and companion Markdown unless the user explicitly requests a different language. Do not translate source code identifiers, file paths, commands, API routes, or `REQUIREMENTS_*` marker names.

## Output

Create the primary report at:

```text
docs/requirements/{{date}}-project-requirements.html
```

If a companion Markdown file is useful, create:

```text
docs/requirements/{{date}}-project-requirements.md
```

The HTML should be self-contained: inline CSS, inline JavaScript, no build step, no required external assets.

Use a clean, modern documentation style inspired by Notion and Linear unless the user asks otherwise:

- White background, warm neutral palette (#37352f text, #e9e9e7 borders), blue accents (#2383e2).
- Favor generous whitespace, clean typography, and subtle hover transitions over dense layouts.
- Cards should have rounded corners, minimal borders, and subtle shadow on hover.
- Tables should have uppercase header labels, no row background by default (only on hover).
- Use pill-shaped badges for evidence and risk labels — colored background + matching text, no emoji.
- Diagrams should look like polished internal architecture or business process documentation.
- Avoid playful palettes, strong gradients, decorative blobs, and visually loud illustrations.

Evidence badge class names — use `.tag` or `.badge` with these variants:

| Variant | Use for | Visual |
|---|---|---|
| `.tag.extracted` / `.badge.extracted` | Behavior directly supported by source code | Green text on green background |
| `.tag.inferred` / `.badge.inferred` | Reasonable inference from code relationships | Orange text on orange background |
| `.tag.unknown` / `.badge.unknown` | Needs user confirmation | Gray text on gray background |
| `.tag.warn` / `.badge.warn` | Medium risk or warning | Orange text on orange background |
| `.tag.danger` / `.badge.danger` | Critical/high risk | Red text on red background |
| `.tag.ok` / `.badge.ok` | Low risk or passed check | Green text on green background |

Risk level indicators in tables must use the badge variants above, never emoji. For example: `<span class="badge danger">CRITICAL</span>` not `🔴 CRITICAL`.

Wrap each requirement card in `<details class="card">` with a `<summary>` containing the API name and a one-line description. This makes all cards collapsible by default.

When the target HTML file already exists and contains `REQUIREMENTS_*` marker sections, treat it as the canonical report shell. Edit those marker sections in place instead of replacing the whole file. Preserve the existing CSS, JavaScript, navigation, metadata, and surrounding structure unless the user explicitly asks to redesign the shell.

Diagrams must be visible and polished when the HTML is opened directly from disk:

- Prefer custom inline SVG, CSS grid/flex diagrams, timeline layouts, swimlanes, and styled cards for architecture maps, dependency graphs, flow summaries, and state/lifecycle diagrams.
- Use semantic SVG groups, `<title>`/`<desc>`, readable labels, arrow markers, stable element ids, and source evidence links where useful.
- Keep diagrams evidence-based and readable. Prefer fewer correct nodes over a dense speculative map.
- Do not use Mermaid as the rendered diagram format unless the user explicitly asks for Mermaid source.
- Avoid showing raw diagram source blocks in the final HTML unless the user explicitly asks for source-only diagrams.

For medium or large projects, do not generate the entire HTML document in one model response or one huge `write` call. Create the report incrementally:

1. Write a complete HTML shell first: `doctype`, `<head>`, inline CSS, navigation container, empty main sections, inline script, and closing tags.
2. Add each major section with smaller `edit` insertions before a stable marker such as `<!-- REQUIREMENTS_SECTIONS -->`.
3. Keep each write/edit chunk focused: one section, one API group, or one diagram at a time.
4. After each chunk, preserve valid HTML and keep the marker in place until the final cleanup.
5. In the final pass, remove unused markers and verify the file can be opened directly from disk.

This chunked approach is required for HTML reports because inline CSS, JavaScript, diagrams, and API cards can become much larger than Markdown. It also gives the user immediate visible tool progress instead of waiting for one giant generated tool call.

## Process

1. Inspect the project before writing:
   - Read top-level docs such as `README.md`, `OPERATIONS.md`, `docs/`, and deployment notes.
   - Identify the stack from package manifests, route files, command handlers, API clients, database modules, schemas, and tests.
   - Search with `rg` for routes, handlers, controllers, commands, schemas, migrations, HTTP verbs, RPC methods, queue handlers, and CLI subcommands.
2. Build an evidence map:
   - `EXTRACTED`: behavior directly supported by source code, docs, tests, config, or schemas.
   - `INFERRED`: reasonable product requirement inferred from code relationships.
   - `UNKNOWN`: requirement, owner, actor, edge case, or business rule that needs user confirmation.
3. Decompose by API or interface first:
   - HTTP API endpoints.
   - CLI commands and subcommands.
   - Tool calls, MCP handlers, RPC methods, queue jobs, scheduled tasks, or exported SDK functions.
   - UI flows only after the backend/interface layer is mapped, unless the project is frontend-only.
4. Connect each API/interface to requirements:
   - Business capability supported by the interface.
   - User goal and actor.
   - Trigger and entry point.
   - Request/input shape.
   - Response/output shape.
   - Business rules and decision points.
   - Validation and permission rules.
   - Data read/write behavior.
   - Internal modules called.
   - External services or files touched.
   - Error cases and retry/rollback behavior.
   - Observability, audit, and security notes.
   - Acceptance criteria.
   - Open questions that block final confirmation.
5. Generate diagrams:
   - Product flowchart for the main user journey.
   - API dependency graph linking endpoints/commands to modules, data stores, and external services.
   - Sequence diagram for at least one high-value flow.
   - State or lifecycle diagram when the domain has clear states.
   - Render each diagram as polished inline HTML/CSS or SVG that is visible offline without external JavaScript.
6. Write the report and preserve traceability:
   - Link sections with stable anchors.
   - Include code file paths for evidence.
   - Mark inferred or unknown content visibly.
   - Avoid pretending uncertain requirements are confirmed.
   - For HTML output, write the shell first, then append/insert sections incrementally instead of producing one large complete file in a single tool call.

## HTML Structure

Use this structure unless the project suggests a better one:

1. Executive summary.
2. System map with a high-level static SVG or CSS architecture diagram.
3. API/interface inventory with filters or grouped navigation.
4. Per-API requirement cards.
5. Core user flows with diagrams.
6. Domain model and data ownership.
7. Permissions, security, and compliance notes.
8. Error handling and edge cases.
9. Non-functional requirements.
10. Open questions and `UNKNOWN` items.
11. Source evidence index.

## Interaction Guidelines

Implement useful interactions with plain JavaScript:

- Sticky table of contents.
- Search/filter input for APIs, modules, and tags.
- Expand/collapse details for each API.
- Anchor links for every API and flow.
- Evidence tags: `EXTRACTED`, `INFERRED`, `UNKNOWN`.
- Back-to-top links for long reports.
- Optional "show only open questions" toggle.

Keep interactions accessible:

- Use semantic headings, buttons, tables, and lists.
- Make controls keyboard reachable.
- Do not hide critical content behind JavaScript-only rendering.
- Ensure the document remains readable if JavaScript is disabled.

## API Section Template

For each API, command, handler, or externally visible interface, include:

```text
Name:
Type:
Route/command/function:
Evidence:
Actor:
Goal:
Inputs:
Outputs:
Preconditions:
Main flow:
Alternative flows:
Validation:
Permissions:
Data reads:
Data writes:
Internal dependencies:
External dependencies:
Errors:
Observability:
Acceptance criteria:
Open questions:
```

## Diagram Patterns

Use custom HTML/CSS/SVG diagrams when diagrams help compress complexity. The visual output should look intentional, readable, and report-quality, not like raw generated graph syntax.

Inline SVG architecture map:

```html
<figure class="diagram-card" id="system-architecture">
  <figcaption>System architecture</figcaption>
  <svg viewBox="0 0 960 380" role="img" aria-labelledby="arch-title arch-desc">
    <title id="arch-title">System architecture</title>
    <desc id="arch-desc">CLI entry points call the runtime, which coordinates tools and persisted session state.</desc>
    <defs>
      <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
        <path d="M0,0 L0,6 L9,3 z"></path>
      </marker>
    </defs>
    <g class="node">
      <rect x="48" y="72" width="190" height="86" rx="10"></rect>
      <text x="72" y="122">CLI Entry</text>
    </g>
    <g class="node">
      <rect x="386" y="72" width="210" height="86" rx="10"></rect>
      <text x="410" y="122">Runtime</text>
    </g>
    <line x1="238" y1="115" x2="386" y2="115" marker-end="url(#arrow)"></line>
  </svg>
</figure>
```

CSS box architecture map:

```html
<section class="dependency-map" aria-label="System architecture">
  <a class="dep-node" href="#api-chat">Chat command</a>
  <span class="dep-edge">→</span>
  <a class="dep-node" href="#runtime-agent-loop">Agent loop</a>
  <span class="dep-edge">→</span>
  <a class="dep-node" href="#tools-write">Tools</a>
</section>
```

Product flow:

```html
<ol class="flow-steps" aria-label="Product flow">
  <li><strong>User starts task</strong><span>Input is collected from CLI or UI.</span></li>
  <li><strong>System validates input</strong><span>Policy, mode, and project context are checked.</span></li>
  <li><strong>System performs core action</strong><span>Runtime coordinates model calls and tools.</span></li>
  <li><strong>User receives result</strong><span>Final answer, artifacts, and evidence are returned.</span></li>
</ol>
```

API dependency map:

```html
<section class="dependency-map" aria-label="API dependency map">
  <a class="dep-node" href="#api-command">API or command</a>
  <span class="dep-edge">→</span>
  <a class="dep-node" href="#handler">Handler</a>
  <span class="dep-edge">→</span>
  <a class="dep-node" href="#service">Service</a>
  <span class="dep-edge">→</span>
  <a class="dep-node" href="#store">Data store</a>
</section>
```

Sequence flow:

```html
<table class="sequence-table">
  <thead><tr><th>Step</th><th>Sender</th><th>Receiver</th><th>Message</th></tr></thead>
  <tbody>
    <tr><td>1</td><td>User</td><td>API</td><td>Request</td></tr>
    <tr><td>2</td><td>API</td><td>Service</td><td>Validate and execute</td></tr>
    <tr><td>3</td><td>Service</td><td>Store</td><td>Read/write data</td></tr>
    <tr><td>4</td><td>API</td><td>User</td><td>Response</td></tr>
  </tbody>
</table>
```

## Quality Bar

The report is complete when:

- A reader can find every major API or user-facing interface from the navigation.
- Each interface has at least one source evidence path.
- Main flows and dependencies are represented both in text and diagrams.
- Inferred requirements are labeled instead of stated as facts.
- Open questions are grouped so the user can resolve them later.
- The HTML can be opened directly from disk in a browser.

## Content Guidelines

Avoid duplication between sections:

- The Executive Summary risk list should contain only the **top 2-3 most critical risks** with one-sentence descriptions. The full risk matrix belongs in the Security section only.
- Key capabilities in the summary should be a concise table (name + one-liner + evidence). Detailed descriptions belong in the per-API requirement cards.
- Non-functional findings should appear only in the Non-functional section, not duplicated in the summary.

Open questions should be **actionable and specific**:

- Do NOT list questions that can be answered by reading the source code (e.g. "What is the test coverage?", "Is there CI/CD?"). Instead, investigate and report the answer directly.
- Do NOT list questions about whether a feature exists — check the code first and report what you find.
- Only list questions that require **human decision-making**, **business context**, or **stakeholder input** that cannot be derived from the codebase.
- Each open question should clearly state what decision or confirmation is needed and why it matters.
