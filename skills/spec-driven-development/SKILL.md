---
name: spec-driven-development
description: Use before coding new features, significant behavior changes, architecture changes, or ambiguous requests; defines assumptions, boundaries, success criteria, and validation first
---

# Spec-Driven Development

Write down what "done" means before code changes make assumptions expensive.

## When to Use

- New feature or significant behavior change
- Cross-module, CLI/runtime/UI, storage, approval, shell, security, or public API work
- Ambiguous requirements or subjective success
- Work likely to need more than one focused session

## Lightweight Spec

For Codemini work, a useful spec can be short. Cover:

1. **Objective** - What changes and why.
2. **Assumptions** - Facts you are relying on.
3. **Non-goals** - What is intentionally out of scope.
4. **Behavior** - User-visible or API/CLI behavior.
5. **Boundaries** - Files, modules, data, shell, security, and compatibility constraints.
6. **Success criteria** - Specific conditions that prove completion.
7. **Verification** - Commands or manual checks that prove the criteria.

## Task Breakdown

When the spec needs implementation planning, break it into small tasks. Each task should include:

- **Goal:** one concrete outcome.
- **Likely files:** expected edit/read targets.
- **Dependencies:** what must happen first.
- **Acceptance:** observable result.
- **Verification:** focused command or manual check.

Keep risky or contract-setting work early. Avoid generic "inspect, implement, test" plans when a small known-target step is enough.

## Workflow

1. Inspect enough project context to avoid an abstract spec.
2. Surface assumptions before filling gaps.
3. Ask only for missing decisions that cannot be safely inferred.
4. Break the work into ordered tasks when implementation is more than one step.
5. Save or attach the spec when the project flow requires approval.
6. Update the spec if implementation reveals a material change.

## Red Flags

- Starting code before success criteria are clear
- Treating a post-hoc summary as a spec
- Hiding assumptions in implementation details
- Making architecture choices without documenting the boundary
- Tasks without acceptance criteria or verification

## Exit Criteria

- A reviewer can tell what is in scope, out of scope, and how completion will be proven.
- Multi-step work has ordered tasks with acceptance and verification.
