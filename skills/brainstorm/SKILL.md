---
name: brainstorm
description: Lightweight brainstorming skill for 30B-class models. Use when a feature or behavior request is still unclear and the agent should compare a few approaches before coding.
version: 0.1.0
---

Use this skill only after the controller has decided the task needs clarification or option comparison before coding.

Primary purpose:
- ask one high-value question when a key constraint is missing
- compare 2-3 short options when the goal is clear but the approach is not
- stop at a clear decision point

Rules:

1. Ask one question at a time.
Do not dump a long questionnaire. Pick the most important uncertainty and resolve it first.

1a. If a key uncertainty remains, stop after one question.
Do not ask multiple numbered questions in the same reply. Do not continue into options, decisions, code, or file edits until that question is answered.

2. Stay concrete.
Focus only on the uncertainty that blocks execution.

3. Offer 2-3 approaches only when the key constraint is already clear.
Keep each option short and focused on the main tradeoff.

4. Keep the design small.
Do not expand a simple task into a long design discussion.

5. Confirm before implementation.
If options were given, wait for the user to choose unless the user explicitly asks for a recommendation.

6. No code before convergence.
Do not write implementation code, pseudo-code, or file edits while the direction is still being chosen.

7. Do not decide for the user when the request is still under-specified.
If the user has not provided enough information to choose confidently, ask the next best question and wait.

8. Do not inspect the repo unless existing project context is directly relevant.
For greenfield brainstorming, stay in conversation mode first.

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

Decision:
- chosen:
- reason:

After decision:
- stop after the chosen direction unless the user clearly asks to continue into implementation

Suggested flow:
- Restate the task briefly
- Choose one mode only: Question or Options
- Stop at a clear decision point

Avoid:
- large ceremonies
- repeating the full conversation
- asking multiple independent questions in one turn
- proposing implementation details before the problem is clear
