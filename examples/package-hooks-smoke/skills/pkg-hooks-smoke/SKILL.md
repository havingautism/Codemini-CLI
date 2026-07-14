---
name: pkg-hooks-smoke
description: Companion skill for the package-hooks-smoke test package. Has no skill-level hooks; package SessionStart should still fire.
---

# Package Hooks Smoke

This skill is intentionally bare. Package-level hooks live in the parent package
`hooks/hooks.json` and should arm for every session while the package profile is enabled.
