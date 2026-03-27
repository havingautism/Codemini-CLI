---
name: superpowers-lite
description: Concise workflow skill tuned for 30B-class models: search first, keep context tight, use sub-agents for narrow tasks, and verify before claiming success.
version: 0.1.0
---

Use this skill as the default lightweight operating style for coding work.

Core rules:

1. Search first.
Use `rg` for repo search before broad file reads. Prefer local context commands and read only the smallest useful slice.

2. Keep context tight.
Do not carry full conversation history into every step. Summarize, narrow scope, and work from the most recent relevant evidence.

3. Prefer narrow sub-agents.
When a task can be split cleanly, use sub-agents for bounded subtasks so the main thread keeps global focus. Give each sub-agent:
- one clear objective
- a tiny context summary
- a tiny file evidence packet
- a concrete expected output

4. Read and write with intent.
Use `read_file` only when shell output is not enough. Use `write_file` for edits. Avoid unnecessary tool calls and avoid rereading the same file without a reason.

5. Verify before claiming success.
Run the relevant test, check, or command before saying work is fixed or complete.

Default workflow:
- Search with `rg`
- Inspect local context
- Plan the next smallest step
- Delegate if the work is independent
- Edit
- Verify
- Summarize briefly

Sub-agent guidance:
- `planner`: break work into steps, risks, and checks
- `coder`: implement one bounded change
- `reviewer`: look for bugs, regressions, and missing verification

If the task is simple, stay lightweight. Do not expand into a large ceremony unless the problem actually needs it.
