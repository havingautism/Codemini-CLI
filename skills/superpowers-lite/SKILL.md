---
name: superpowers-lite
description: Concise workflow skill tuned for 30B-class models: prefer structured code tools first, keep context tight, use sub-agents for narrow tasks, and verify before claiming success.
version: 0.3.0
---

Use this skill as the default operating style for all coding work, preferring lightweight approaches but invoking specialized skills when needed.

This is the default, not an interrogation mode. Keep help calm and direct. For decisions that affect multiple systems, involve irreversible changes, or have significant user impact only, add a light Grill Me pass: ask 1-3 sharp questions about assumptions, failure modes, or verification before proceeding. Challenge the plan, not the person.

**Announce when using a skill:** Before following any route below, say "Using [skill name] to [purpose]" in your response. This signals intent and prevents silent skill skipping.

## Mandatory Skill Check

Before responding to ANY user message, check whether a skill applies. If there is even a small chance a skill is relevant, YOU MUST invoke it. This is not optional.

**Skill check comes BEFORE:**

- Clarifying questions
- Code exploration
- Writing code
- Anything else

## Anti-Rationalization

If you catch yourself thinking any of the following, STOP — you are about to skip a skill incorrectly:

| Thought                             | Reality                                             |
| ----------------------------------- | --------------------------------------------------- |
| "This is too simple for a skill"    | Simple tasks derail too. Use the skill.             |
| "I need more context first"         | Skills tell you HOW to gather context. Check first. |
| "The skill is overkill here"        | A lightweight pass is cheaper than rework.          |
| "I'll just do this one thing first" | Do the skill check BEFORE anything.                 |
| "I already know what to do"         | Knowing the concept ≠ following the process.        |

## Routing

Evaluate the user's request and YOU MUST follow exactly one route:

| Condition                                                                                                          | Action                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Task is clear, small, and obvious path                                                                             | Execute directly. Do NOT invoke brainstorming.                                                                                                |
| Non-trivial implementation that needs codebase exploration, touches multiple areas, or changes shared behavior     | YOU MUST invoke `writing-plans` skill. Inspect first, then present an implementation plan for approval. Do NOT jump straight into coding.     |
| Goal is clear but multiple reasonable approaches exist and the missing piece is user preference or tradeoff choice | YOU MUST invoke `brainstorm` skill. Follow brainstorm process — do NOT substitute it with ad-hoc questions.                                   |
| Request is missing a key constraint or success condition                                                           | Ask exactly one clarifying question. Do NOT give options or write code. Stop and wait for the answer.                                         |
| Request is greenfield and underspecified ("build a page", "make a site", "generate an app")                        | Treat as missing key constraints. Ask one high-value question. Do NOT assume features, scope, or storage model. Stop and wait for the answer. |

**Decision boundary:**

- Use `brainstorm` when one focused user answer will determine the direction.
- Use `writing-plans` when the task is implementation-shaped but needs a plan before coding.
- If both could apply, prefer `brainstorm` first when the core uncertainty is user intent; prefer `writing-plans` first when the core uncertainty is codebase impact.

## Tool Order

- Prefer `grep` first for content search and candidate discovery
- Use `read` to inspect the smallest useful code block
- Use `edit` for minimal focused edits or whole-file rewrites
- Use `glob` when you need file or directory discovery
- Use shell search (`rg`) only as a fallback

## Core Rules

1. **Search first.** Start with `grep`, then `read`. Fall back to shell only when structured tools aren't enough.

2. **Keep context tight.** Do not carry full conversation history into every step. Summarize and narrow scope.

3. **Prefer narrow sub-agents.** When a task splits cleanly, delegate to sub-agents with: one clear objective, tiny context, concrete expected output.

4. **Do not code against unclear requirements.** Missing constraint → ask one question. Multiple approaches → `brainstorm`. Clear enough → proceed.

5. **Verify before claiming success.** Run the relevant test or command before saying work is done.

6. **Use sharp questions sparingly.** For high-risk work, ask 1-3 sharp questions that expose assumptions or likely failure modes. For ordinary tasks, stay lightweight and keep moving.

## Sub-agent Guidance

- `planner`: break work into steps, risks, and checks
- `coder`: implement one bounded change
- `reviewer`: look for bugs, regressions, and missing verification

If the task is simple, stay lightweight. Do not expand into ceremony unless the problem needs it.
