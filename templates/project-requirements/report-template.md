# {{title}}

> Generated: {{generated_at}}  
> Workspace: `{{workspace_name}}`  
> Required prose language: {{reply_language}}

<!--
PROJECT_REQUIREMENTS_MD_TEMPLATE

Fill this Markdown template in the required prose language above. Replace every
REQUIREMENTS_* marker section with finished report content. Preserve source code
identifiers, file paths, commands, API routes, and marker names exactly.

Keep the final document readable in plain text, Git diffs, and Markdown previewers.
Use compact Markdown tables for inventories and per-interface summaries.
Use EXTRACTED, INFERRED, and UNKNOWN labels for traceability.
-->

## <!-- REQUIREMENTS_SUMMARY --> Executive Summary

<!-- Fill with project purpose, main actors, major capabilities, top risks, and confidence level. -->

## <!-- REQUIREMENTS_ARCHITECTURE --> System Map

<!-- Fill with a concise architecture overview. Use Markdown lists or tables. Use Mermaid only if the user explicitly requested Mermaid. -->

## <!-- REQUIREMENTS_INTERFACE_INVENTORY --> API And Interface Inventory

<!-- Fill with a table of HTTP endpoints, CLI commands, tools, RPC/MCP handlers, exported functions, scheduled jobs, and key UI flows. -->

| Interface | Type | Entry Point | Capability | Evidence | Status |
|---|---|---|---|---|---|
| TBD | TBD | TBD | TBD | TBD | UNKNOWN |

## <!-- REQUIREMENTS_API_CARDS --> Requirements By Interface

<!-- Fill one subsection per major API/interface. Keep each subsection evidence-backed. -->

### Interface Name

| Field | Details |
|---|---|
| Type | TBD |
| Entry point | TBD |
| Actor | TBD |
| Goal | TBD |
| Inputs | TBD |
| Outputs | TBD |
| Business rules | TBD |
| Validation | TBD |
| Permissions | TBD |
| Data reads | TBD |
| Data writes | TBD |
| Internal dependencies | TBD |
| External dependencies | TBD |
| Errors | TBD |
| Observability | TBD |
| Acceptance criteria | TBD |
| Evidence | TBD |
| Open questions | TBD |

## <!-- REQUIREMENTS_FLOWS --> Core User And System Flows

<!-- Fill with numbered flows, sequence summaries, and dependency chains. -->

## <!-- REQUIREMENTS_DOMAIN_MODEL --> Domain Model And Data Ownership

<!-- Fill with domain entities, files/stores/tables, ownership, lifecycle, and state transitions. -->

## <!-- REQUIREMENTS_SECURITY --> Permissions, Security, And Compliance

<!-- Fill with authentication, authorization, sensitive data, audit, policy, and compliance notes. -->

## <!-- REQUIREMENTS_ERROR_HANDLING --> Error Handling And Edge Cases

<!-- Fill with failure modes, retries, rollback behavior, user-facing errors, and operational risks. -->

## <!-- REQUIREMENTS_NONFUNCTIONAL --> Non-Functional Requirements

<!-- Fill with performance, reliability, portability, maintainability, observability, and compatibility requirements. -->

## <!-- REQUIREMENTS_OPEN_QUESTIONS --> Open Questions

<!-- Fill with UNKNOWN items that need product, engineering, security, or operations confirmation. -->

## <!-- REQUIREMENTS_EVIDENCE_INDEX --> Source Evidence Index

<!-- Fill with grouped source paths and short notes explaining what each file proves. -->
