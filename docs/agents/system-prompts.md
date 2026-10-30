# System prompt ownership and size

Keep shared rules in one owned layer. Review the assembled model request when
changing prompts; a short individual block can still repeat another layer.

| Layer | Owner | Content |
| --- | --- | --- |
| Shared base | `default-system-prompt.js`, `shell-profile.js` | Shell safety, source tools, editing rules, task lifecycle, tool argument examples, web tool discovery, writing, environment |
| Soul | `soul.js`, selected preset | Tone; coding presets may also influence engineering approach within correctness, security, and user constraints |
| Project and skills | `system-prompt-composer.js` | Project instructions and selected skill index, preserved as supplied |
| Execution mode | `chat-runtime.js:buildExecutionModePromptBlock` | Daily interaction/research or coding workflow, quality, delegation, and material decisions |
| Crew overlay | `crew-store.js:buildCrewModePromptBlock` | Coordinator workflow instead of ordinary daily/coding mode rules |
| Reply language | `reply-language.js` | Response and durable prose language, including memory; do not repeat language rules in the memory guide |
| Bootstrap memory | `system-prompt-composer.js` | Frozen session snapshot at the end, after reply language |

The live runtime inserts the mode block before reply language. Turn-specific
recall, hook output, routing hints, and always-skill content belong to the user
turn. Project navigation is injected once and retained in history. Forks inherit
the parent's assembled prompt and skip mode/system re-insertion to preserve the
exact cached prefix. Subagents use their own stable shell prompt and scoped task.

Do not deduplicate arbitrary supplied project, skill, or memory text by line or
substring. Repetition there may be intentional. Remove overlapping rules at
their authored source instead. Preserve platform-specific tool argument names,
sandbox boundaries, generated-file workflows, and Crew coordinator restrictions.

## 2026-10-26 size comparison

JavaScript string lengths in the same workspace, with sandbox disabled,
coding Soul `Default`, daily Soul `Soft`, Simplified Chinese reply language,
and no project, skill, or memory content. Counts include the shared base, Soul
and guard, execution mode, and reply-language directive. Workspace paths and
presets affect these totals; these are character counts, not tokenizer results
or measured billing/cache savings.

| Host / mode | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Windows / daily | 7,400 | 6,467 | 12.6% |
| Windows / coding | 9,269 | 7,297 | 21.3% |
| Linux / daily | 7,193 | 6,222 | 13.5% |
| Linux / coding | 9,012 | 7,052 | 21.7% |
| macOS / daily | 7,195 | 6,224 | 13.5% |
| macOS / coding | 9,014 | 7,054 | 21.7% |

The coding quality rules were added within this smaller total. Savings come
from shared tool/editing rules, compact delegation and decision guidance,
web examples, and removal of generic writing rules repeated in the default Soul.

## Verification

- `tests/system-prompt-composition.test.js`: assembled daily/coding layers on
  Windows, Linux, macOS, Windows VM, and OS confinement; Crew overlay; preservation
  of supplied instructions; size budgets and memory placement.
- `tests/memory-cache-prefix.test.js`: actual local model requests across turns,
  including full base prompts, project instructions, frozen memory, and exactly
  one execution-mode/language/Soul guard block.
- `tests/default-system-prompt.test.js` and `tests/workflow-route.test.js`:
  platform tools, sandbox restrictions, disabled search, and coding-only quality.

Use `node scripts/run-tests.js <test paths>` for focused checks and `npm test`
for the full suite; the wrapper isolates the real user configuration.

Validation for this change:

- Final prompt-focused run: 76 passed, zero failures.
- Additional composition/cache/Crew-mode run: 48 passed, zero failures (overlaps
  the prompt-focused run).
- Full-suite snapshot: 1,427 passed, five failed, five skipped. The two Crew
  failures (`crew-events` and `crew-review`), disclosure-tree assertion, and
  shell-wrapper exit 127 also reproduce in a temporary export of the original
  HEAD, without these changes.
- The remaining PowerShell ANSI assertion fails in the workspace and passes
  in the temporary HEAD directory. Its terminal-layout/environment sensitivity
  remains unresolved; the full suite is not clean.
- Sandboxed loopback connections returned EACCES; local HTTP integration checks
  passed when rerun outside confinement with the same isolated test wrapper.
