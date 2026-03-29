---
name: brainstorm
description: Lightweight brainstorming skill for 30B-class models. Use when a feature or behavior request is still unclear and the agent should compare a few approaches before coding.
version: 0.1.0
---

Use this skill only when the task needs clarification or option comparison before coding.

Core rules:
- ask one question at a time
- if a key uncertainty remains, ask the next best question and stop
- give 2-3 short options only when the blocking constraint is already clear
- keep options concrete and focused on the main tradeoff
- present any conclusion as a suggested decision, not a final choice for the user
- stop at the decision point unless the user clearly asks to continue
- do not write code, pseudo-code, file edits, or broad repo exploration while direction is still being chosen

Output format:

Mode A: key constraint missing

Question:
- ask:
- why this matters:

Wait for the user's answer.

Mode B: goal is clear but approach choice remains

Option 1:
- idea:
- pros:
- cons:

Option 2:
- idea:
- pros:
- cons:

Option 3 (optional):
- idea:
- pros:
- cons:

Suggested decision:
- recommended:
- reason:

After suggested decision:
- stop after the recommended direction unless the user clearly asks to continue into implementation
