---
name: brainstorm
description: Lightweight brainstorming skill. Use when a feature or behavior request has multiple reasonable approaches and the missing piece is user preference, tradeoff choice, or key constraint.
version: 0.2.1
---

Use this skill only when the task needs clarification or option comparison before coding.

**Announce:** When entering brainstorm, say "Using brainstorm to explore approaches before implementation."

## Anti-Pattern

Do NOT skip this skill for tasks that appear straightforward but lack clear requirements or constraints. Underspecified tasks cause the most wasted work. Even a few seconds of clarification beats a wrong implementation.

## Process

1. **Ask one question at a time.** If a key uncertainty remains, ask the next best question and STOP. Wait for the user's answer.
2. **Give 2-3 short options** only when the blocking constraint is already clear. Keep options concrete and focused on the main tradeoff.
3. **Present conclusions as suggested decisions**, not final choices.
4. **Do NOT write code, pseudo-code, file edits, or broad repo exploration** while direction is still being chosen.
5. **Stop after your brainstorm response.** Do not say "I will start", "starting now", "I'll edit", or otherwise transition into implementation in the same turn.

## Output Formats

### Mode A: key constraint missing

```
Question:
- ask: <one specific question>
- why this matters: <1-2 sentences on what this decides>
```

Wait for the user's answer. Do NOT proceed with options or code.

### Mode B: goal is clear but approach choice remains

```
Option 1:
- idea: <concrete approach>
- pros: <1-2 points>
- cons: <1-2 points>

Option 2:
- idea: <concrete approach>
- pros: <1-2 points>
- cons: <1-2 points>

Option 3 (optional):
- idea: <concrete approach>
- pros: <1-2 points>
- cons: <1-2 points>

Suggested decision:
- recommended: <option N>
- reason: <why>
```

After Mode B, STOP. Wait for the user to approve, reject, or revise the suggested decision.

## Self-Review

Before presenting options or a suggested decision, quickly check:

- Are all options actually different, or are two of them the same idea in different words?
- Does the recommended option match the user's stated constraints?
- Did I invent requirements the user never mentioned? Remove them.

## Exit

Brainstorm ends only when the user sends a later message that clearly approves a direction, for example "use option 2", "按这个做", "确认，开始实现", or "直接写代码".

After that later user approval:

- If the task is small and clear enough to implement directly → proceed to code.
- If the task is non-trivial or touches multiple areas → YOU MUST invoke `writing-plans` to create an implementation plan before coding.

Do NOT treat your own suggested decision as approval. Do NOT continue from the brainstorm conclusion into planning or implementation until the user has explicitly approved a direction in a separate message.
