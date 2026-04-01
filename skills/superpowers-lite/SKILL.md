---
name: superpowers-lite
description: Concise workflow skill tuned for 30B-class models: prefer structured code tools first, keep context tight, use sub-agents for narrow tasks, and verify before claiming success.
version: 0.1.0
---

Use this skill as the default lightweight operating style for coding work.

Primary behavior:
- keep momentum on clear tasks
- slow down before coding when the request is ambiguous
- keep edits local
- verify before claiming success

Routing:

1. If the task is clear, small, and the implementation path is obvious:
- execute directly
- do not force brainstorming

2. If the task is a non-trivial implementation that likely needs codebase exploration, touches multiple areas, changes shared behavior, or needs explicit review/testing before coding:
- prefer `auto plan`
- inspect first, then present a short implementation plan for approval
- do not jump straight into coding
- do not use `brainstorm` as a substitute for implementation planning

3. If the goal is clear but there are multiple reasonable implementation paths and the missing piece is mainly user preference, tradeoff choice, or one key constraint:
- use `brainstorm`
- ask exactly one clarifying question first
- do not give options, recommendations, or a tentative solution in the same response
- stop after the question and wait for the user's answer before continuing

4. If the request is still missing a key constraint or success condition:
- ask exactly one clarifying question
- do not give options yet
- do not write code yet
- stop after the question and wait for the user's answer

5. If the request is greenfield and underspecified, such as "build a page", "make a site", "generate an app", or similar:
- treat it as missing key constraints by default
- ask one high-value question before coding
- do not assume features, storage model, or scope unless the user already gave them
- stop after the question and wait for the user's answer

Decision boundary:
- Use `brainstorm` when one focused user answer will determine the direction.
- Use `auto plan` when the task is already implementation-shaped but the work is large enough that you should explore first and get sign-off on the plan.
- If both could apply, prefer `brainstorm` first when the core uncertainty is user intent; prefer `auto plan` first when the core uncertainty is codebase impact and execution shape.

Tool order:
- prefer `grep` first for content search and candidate discovery
- use `read` to inspect the smallest useful code block
- use `edit` for minimal focused edits or direct whole-file rewrites when you already have the replacement content
- use `generate_diff` and `patch` for larger edits or when you already have a diff
- use `glob` and `list` when you need file or directory discovery
- use shell search such as `rg` only as a fallback when structured tools are not enough

Core rules:

1. Search first.
Prefer structured search before broad file reads. Start with `grep`, then inspect with `read`, and only fall back to shell search such as `rg` when the structured tools are not enough.

2. Keep context tight.
Do not carry full conversation history into every step. Summarize, narrow scope, and work from the most recent relevant evidence.

3. Prefer narrow sub-agents.
When a task can be split cleanly, use sub-agents for bounded subtasks so the main thread keeps global focus. Give each sub-agent:
- one clear objective
- a tiny context summary
- a tiny file evidence packet
- a concrete expected output

4. Do not code against unclear requirements.
If the requested behavior, scope, or acceptance is unclear, do not jump into implementation. First decide which of these applies:
- missing key constraint -> ask one question
- multiple valid approaches -> use `brainstorm`
- clear enough to build -> proceed

5. Read and write with intent.
Use `read` before broad reads when possible. Use `edit` for focused edits or when you already have the complete replacement content. Use `generate_diff` and `patch` for larger changes. Use `write` only for creating new files or explicit whole-file writes. Avoid unnecessary tool calls and avoid rereading the same file without a reason.

6. Verify before claiming success.
Run the relevant test, check, or command before saying work is fixed or complete.

Default workflow:
- Search with `grep`
- Inspect local context with `read`
- If the request is unclear, first decide: ask one question, brainstorm, auto plan, or proceed
- Plan the next smallest step
- Delegate if the work is independent
- Edit with `edit`
- Verify
- Summarize briefly

Sub-agent guidance:
- `planner`: break work into steps, risks, and checks
- `coder`: implement one bounded change
- `reviewer`: look for bugs, regressions, and missing verification

If the task is simple, stay lightweight. Do not expand into a large ceremony unless the problem actually needs it.
