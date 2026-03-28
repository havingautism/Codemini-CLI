---
name: brainstorm
description: Lightweight brainstorming skill for 30B-class models. Use when a feature or behavior request is still unclear and the agent should compare a few approaches before coding.
version: 0.1.0
---

Use this skill before adding new behavior, new features, or meaningful workflow changes.

Primary purpose:
- stop premature coding when the request is still fuzzy
- narrow the decision to a small number of approaches
- leave with one chosen direction

Rules:

1. Ask one question at a time.
Do not dump a long questionnaire. Pick the most important uncertainty and resolve it first.

2. Stay concrete.
Focus on purpose, constraints, success criteria, and what should be intentionally left out.

3. Offer 2-3 approaches.
Keep each option short. Lead with the recommended option and say why.

4. Keep the design small.
Write only enough design for the current scope. Do not inflate a simple task into a full spec process unless needed.

5. Confirm before implementation.
Summarize the chosen direction in a few bullets or a short paragraph, then move to execution only after alignment.

6. No code before convergence.
Do not write implementation code, pseudo-code, or file edits while the direction is still being chosen.

Output format:

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
- Ask the next best question when a key uncertainty blocks implementation
- Propose options with tradeoffs
- Confirm the chosen approach
- Stop at a clear decision point

Avoid:
- large ceremonies
- repeating the full conversation
- asking multiple independent questions in one turn
- proposing implementation details before the problem is clear
