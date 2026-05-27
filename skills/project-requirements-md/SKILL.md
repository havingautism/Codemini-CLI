---
name: project-requirements-md
description: Generate a Markdown project requirements report from an existing codebase. Use when the user asks for a text-first PRD, requirements document, PR-friendly source document, Markdown CodeWiki report, or `.md` project demand analysis.
version: 0.1.0
---

Use this skill to reverse-engineer a project into a Markdown requirements document that product, engineering, and QA can review in plain text, Git diffs, and Markdown previewers.

This is the Markdown report skill. Do not produce the interactive HTML report here; the HTML version uses the separate `project-requirements` skill.

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
