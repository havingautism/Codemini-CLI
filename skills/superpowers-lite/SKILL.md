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

2. If the goal is clear but there are multiple reasonable implementation paths:
- use `brainstorm`
- give 2-3 short options
- do not choose for the user unless the user explicitly asks for a recommendation

3. If the request is still missing a key constraint or success condition:
- ask exactly one clarifying question
- do not give options yet
- do not write code yet

4. If the request is greenfield and underspecified, such as "build a page", "make a site", "generate an app", or similar:
- treat it as missing key constraints by default
- ask one high-value question before coding
- do not assume features, storage model, or scope unless the user already gave them

Tool order:
- prefer `locate` first for repo search and candidate discovery
- use `open_target` to inspect the smallest useful code block with edit metadata
- use `edit_target` for minimal validated edits
- use `search_code`, `read_block`, and `read_symbol_context` when lower-level structured context is needed
- use shell search such as `rg` only as a fallback when structured tools are not enough

Core rules:

1. Search first.
Prefer structured search before broad file reads. Start with `locate`, then inspect with `open_target`, and only fall back to shell search such as `rg` when the structured tools are not enough.

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
Use `open_target`, `read_block`, and `read_symbol_context` before `read_file` when possible. Use `edit_target` for focused edits. Use `write_file` only for full-file writes. Avoid unnecessary tool calls and avoid rereading the same file without a reason.

6. Verify before claiming success.
Run the relevant test, check, or command before saying work is fixed or complete.

Default workflow:
- Search with `locate`
- Inspect local context with `open_target`
- If the request is unclear, first decide: ask one question, brainstorm, or proceed
- Plan the next smallest step
- Delegate if the work is independent
- Edit with `edit_target`
- Verify
- Summarize briefly

Sub-agent guidance:
- `planner`: break work into steps, risks, and checks
- `coder`: implement one bounded change
- `reviewer`: look for bugs, regressions, and missing verification

If the task is simple, stay lightweight. Do not expand into a large ceremony unless the problem actually needs it.
