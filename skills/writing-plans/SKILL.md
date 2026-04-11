---
name: writing-plans
description: Use when you have a clear goal or approved design for a non-trivial task, before touching code. Creates a step-by-step implementation plan with exact file paths, code, and verification steps.
version: 0.1.0
---

Use this skill when the task is implementation-shaped but large enough that jumping straight into coding is risky.

**Announce:** When entering writing-plans, say "Using writing-plans to create an implementation plan."

## When to Use

- Task touches 3+ files or multiple areas of the codebase
- Task changes shared behavior, APIs, or data flow
- Task has interdependent steps where order matters
- You need user sign-off before starting work

## When NOT to Use

- Single-file fix with a clear solution → just do it
- Task is a direct extension of an existing pattern → just do it
- User explicitly says to skip planning → respect that

## Plan Format

Write the plan as a markdown checklist. Each step is one action (2-5 minutes of work).

```markdown
# [Task Name] Plan

**Goal:** [one sentence]
**Files:** [list files that will be created or modified]

### Phase 1: [Phase name]

- [ ] **Step N: [action verb + what]**
  - File: `exact/path/to/file.ext`
  - What: [specific change]
  - Verify: [how to confirm it works]

### Phase 2: [Phase name]

- [ ] ...
```

## Rules

1. **Exact file paths always.** No "the relevant file" or "in the component directory".
2. **Show code in steps that change code.** No "add appropriate error handling" without showing the code.
3. **No placeholders.** No "TBD", "TODO", "implement later", "similar to step N". If a step needs code, write the code.
4. **Every step is verifiable.** Include a test command, expected output, or visual check.
5. **YAGNI.** Only plan what was asked for. Do not add "nice to have" steps.
6. **DRY.** If two steps share logic, plan the shared piece first.

## Self-Review

After writing the plan, check:
- Can you point to a step for every requirement? If not, add the missing step.
- Any placeholders or vague descriptions? Replace with specifics.
- Do types and function names match across steps? Fix inconsistencies.
- Is the order correct? Steps that depend on earlier work must come after.

## Exit

After the user approves the plan → proceed to implement step by step.
After each step → verify before moving to the next.
If a step reveals the plan is wrong → stop, explain, and update the plan before continuing.
