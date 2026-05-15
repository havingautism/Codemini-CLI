# AGENTS.md

This repo is Codemini CLI, a local-first coding agent with a CLI, Web UI, project indexing, skills, memories, approvals, and Windows-first shell ergonomics.

## Commands

- Install dependencies: `npm install`
- Run all tests: `npm test`
- Build bundled Web UI: `npm run build:web`
- Run CLI locally: `npm start`

## Task Routing

- CLI command dispatch: start in `src/cli.js`, then `src/commands/`.
- Chat/session runtime behavior: start in `src/core/chat-runtime.js`.
- System prompt composition: start in `src/core/system-prompt-composer.js` and `src/core/default-system-prompt.js`.
- Project map and file index behavior: start in `src/core/project-index.js`.
- Skill discovery, routing, and rendering: start in `src/core/command-loader.js`, then `src/core/skill-registry.js`.
- Reflect-to-skill behavior: start in `src/core/reflect-skill.js`.
- Built-in tool behavior: start in `src/core/tools.js`.
- Web UI API routes: start in `codemini-web/server.js`.
- Web UI state and chat behavior: start in `codemini-web/client/src/context/app-context.jsx` and relevant components under `codemini-web/client/src/components/`.

## Verification

- General runtime changes: run `npm test`.
- Skill routing changes: run `node --test tests/skill-command.test.js tests/default-system-prompt.test.js`.
- Project index changes: run `node --test tests/chat-runtime.test.js tests/tools.test.js`.
- Web UI changes: run `npm run build:web`; add focused tests when behavior crosses the server/client boundary.

## Rules

- Use the project index for orientation, then inspect real source files before editing.
- Keep `AGENTS.md` concise. Put long details in docs and link or route to them here.
- Use skills for reusable workflows. Use `AGENTS.md` for always-needed project facts, routing rules, and verification expectations.
- Do not treat `skills/`, `souls/`, or `templates/` as source architecture unless the task is about those features.
- Do not manually edit generated build output in `codemini-web/dist`.
- Preserve Windows and PowerShell compatibility in commands, docs, and shell-facing behavior.
