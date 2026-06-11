---
name: brainstorming
description: Use when requirements, product intent, UX direction, or implementation approach are unclear and collaborative clarification would reduce rework
---

# Brainstorming

Use this skill to turn an unclear request into a clear direction. Do not use it as a blanket gate for every code change.

## When to Use

- The user's goal is ambiguous or subjective.
- There are multiple plausible product, UX, or architecture directions.
- Missing decisions would cause meaningful rework.
- The user explicitly asks to explore options or brainstorm.

## When Not to Use

- The task is a small, concrete edit with clear success criteria.
- A bug must first be reproduced through `systematic-debugging`.
- The request already has an approved spec or implementation plan.

## Workflow

1. Inspect enough project context to avoid generic advice.
2. State the key assumptions and the decision that needs clarification.
3. Ask one focused question at a time when a user decision is needed.
4. When options are useful, present 2-3 approaches with tradeoffs and a recommendation.
5. Convert the chosen direction into success criteria or hand it to `spec-driven-development` for a written spec.

## Output

Keep the output proportional:

- Tiny ambiguity: one question or a short assumption check.
- Moderate feature: options, recommendation, and success criteria.
- Large or risky feature: transition to `/spec` or `spec-driven-development`.

## Visual Companion

For visual product questions, offer the browser companion only when seeing layout, mockups, diagrams, or comparisons would materially help. If accepted, read:

`skills/brainstorming/visual-companion.md`
