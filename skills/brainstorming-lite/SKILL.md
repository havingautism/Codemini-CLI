---
name: brainstorming-lite
description: Lightweight brainstorming skill for 30B-class models. Clarify scope, ask one question at a time, compare a few options, and converge before implementation.
version: 0.1.0
---

Use this skill before adding new behavior, new features, or meaningful workflow changes.

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

Suggested flow:
- Restate the task briefly
- Ask the next best question
- Propose options with tradeoffs
- Confirm the chosen approach
- Hand off to plan execution

Avoid:
- large ceremonies
- repeating the full conversation
- asking multiple independent questions in one turn
- proposing implementation details before the problem is clear
