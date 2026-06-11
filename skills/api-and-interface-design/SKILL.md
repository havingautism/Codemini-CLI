---
name: api-and-interface-design
description: Use when designing or changing CLI commands, tool schemas, web API routes, module boundaries, public interfaces, or cross-component contracts
---

# API and Interface Design

Design contracts before implementation details. Interfaces are harder to change than internals.

## When to Use

- CLI flags, command behavior, or output format changes
- Built-in tool schemas or MCP/tool contracts
- Web API routes, request/response payloads, or streaming events
- Shared module exports, plugin/skill manifests, or config formats
- Any boundary used by multiple components

## Contract Checklist

1. **Caller and owner** - Who calls this interface and who owns compatibility?
2. **Inputs** - Required/optional fields, defaults, validation, and unknown fields.
3. **Outputs** - Stable shape, error shape, ordering, and empty states.
4. **Compatibility** - Existing users, migration path, aliases, and deprecation behavior.
5. **Failure semantics** - What fails fast, what is recoverable, and what is reported.
6. **Tests** - Contract tests or focused assertions for edge cases.

## Design Rules

- Prefer additive changes over breaking changes.
- Keep one version of the interface unless there is a real migration need.
- Validate at boundaries; trust less as data crosses process, network, file, or user-input boundaries.
- Preserve Windows and PowerShell compatibility for shell-facing interfaces.
- Document behavior through tests when possible.

## Exit Criteria

- The contract can be implemented independently by both sides.
- Error and compatibility behavior are explicit.
- Tests cover at least one success path and meaningful failure/edge path.
