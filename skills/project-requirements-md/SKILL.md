---
name: project-requirements-md
description: Generate a CodeWiki project requirements report in Markdown format from an existing codebase. Same report scope as the HTML CodeWiki—presented as `.md` for plain-text reading, Git diffs, and Markdown previewers.
version: 0.1.0
---

Use this skill to reverse-engineer a project into a CodeWiki requirements report in Markdown format—the same structured analysis as the HTML CodeWiki, presented as `.md` for plain-text review.

This is the Markdown CodeWiki report skill. It produces the same report scope as `project-requirements`, but in Markdown. Do not produce the interactive HTML report here; the HTML version uses the separate `project-requirements` skill.

This command always outputs Markdown. Do not pass `--html` or other HTML format flags here; use `/project-requirements --html` for the same CodeWiki report in HTML format.

User request:

```text
{{args}}
```

Honor any concrete user request above, such as focus area, API subset, diagram style, language, report path, or sections to omit.

Follow the active reply language from the system prompt for all generated report prose, headings, labels, summaries, comments, and open questions unless the user explicitly requests a different language. Do not translate source code identifiers, file paths, commands, API routes, or `REQUIREMENTS_*` marker names.

## Output

Create the primary report at:

```text
docs/requirements/{{date}}-project-requirements.md
```

The runtime pre-creates a Markdown template at the primary path. Treat it as the canonical template and replace every `REQUIREMENTS_*` marker section with finished report content. Preserve useful metadata, source paths, and traceability. Remove template-only comments before final delivery.

Do not create an HTML companion unless the user explicitly asks for both formats.

## Markdown Style

- Use clean Markdown headings, concise paragraphs, tables, and lists.
- Keep the report readable in raw text and Git diffs.
- Prefer compact tables for API inventory, per-interface requirement summaries, evidence, risks, and open questions.
- Use `EXTRACTED`, `INFERRED`, and `UNKNOWN` labels in plain text table cells.
- Do not use raw HTML for layout.
- Do not use Mermaid unless the user explicitly asks for Mermaid source.
- If diagrams are useful without Mermaid, use numbered flows, dependency chains, or compact text tables.
- Keep section headings in the active reply language, while preserving `REQUIREMENTS_*` marker names until final cleanup.

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
   - Tool calls, MCP handlers, RPC methods, queue jobs, scheduled tasks, exported SDK functions, and key UI flows.
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
5. Fill the Markdown template:
   - Replace each marker section with final content.
   - Link sections with stable Markdown anchors where useful.
   - Include code file paths for evidence.
   - Mark inferred or unknown content visibly.
   - Avoid pretending uncertain requirements are confirmed.
6. Self-check before final answer:
   - Major interfaces are covered.
   - Evidence paths are present.
   - `EXTRACTED`, `INFERRED`, and `UNKNOWN` labels are used correctly.
   - The final `.md` is readable as plain text.
   - Template comments and unfinished placeholders are removed or explicitly marked as `UNKNOWN`.

## Recommended Structure

Use the pre-created template structure unless the project strongly suggests a better one:

1. Executive summary.
2. System map.
3. API/interface inventory.
4. Requirements by interface.
5. Core user and system flows.
6. Domain model and data ownership.
7. Permissions, security, and compliance notes.
8. Error handling and edge cases.
9. Non-functional requirements.
10. Open questions and `UNKNOWN` items.
11. Source evidence index.

## Interface Section Template

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

## Quality Bar

The report is complete when:

- A reader can find every major API or user-facing interface from the table of contents or section headings.
- Each interface has at least one source evidence path.
- Main flows and dependencies are represented in text, tables, or concise diagram summaries.
- Inferred requirements are labeled instead of stated as facts.
- Open questions are grouped so the user can resolve them later.
- The Markdown is readable as plain text and in Markdown previewers.

## Content Guidelines

Avoid duplication between sections:

- The Executive Summary risk list should contain only the **top 2-3 most critical risks** with one-sentence descriptions. The full risk matrix belongs in the Security section only.
- Key capabilities in the summary should be a concise table (name + one-liner + evidence). Detailed descriptions belong in the per-interface requirement sections.
- Non-functional findings should appear only in the Non-functional section, not duplicated in the summary.

Open questions should be **actionable and specific**:

- Do NOT list questions that can be answered by reading the source code (e.g. "What is the test coverage?", "Is there CI/CD?"). Instead, investigate and report the answer directly.
- Do NOT list questions about whether a feature exists — check the code first and report what you find.
- Only list questions that require **human decision-making**, **business context**, or **stakeholder input** that cannot be derived from the codebase.
- Each open question should clearly state what decision or confirmation is needed and why it matters.
