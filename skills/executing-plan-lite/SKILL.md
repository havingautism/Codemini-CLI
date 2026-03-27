---
name: executing-plan-lite
description: Lightweight plan execution skill for 30B-class models. Execute the plan in small verified steps with narrow context and frequent checks.
version: 0.1.0
---

Use this skill when a direction is chosen and the next job is to carry out implementation reliably.

Rules:

1. Execute the plan in small verified steps.
Take one bounded step at a time. Avoid mixing planning, implementation, and verification into one big jump.

2. Keep the active context narrow.
Work from the smallest relevant file set and recent evidence. If needed, use sub-agents for independent subtasks.

3. Search before editing.
Use `rg` to locate code, inspect the smallest useful context, then edit.

4. Verify after each meaningful change.
Run the most relevant test or command before claiming success.

5. Report progress briefly.
Summarize what changed, what was verified, and what remains.

Suggested flow:
- identify the next step
- search and inspect
- edit
- verify
- either continue or stop at a clear checkpoint

Use sub-agents when:
- the task can be split cleanly
- the write scope is disjoint
- the result can be reviewed independently

Avoid:
- broad refactors without a reason
- carrying full history into each step
- declaring completion without verification
