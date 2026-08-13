# Skill Hooks Compatibility & Skills UI Redesign

**Date:** 2026-07-14  
**Status:** Approved for planning  
**Goal:** Claude Code–compatible skill hooks (compatibility-first), remove Codemini custom skill modes, and restructure the Skills panel around coding/daily tabs.

## Background

Codemini today exposes skills via:

- A lightweight indexed catalog in the system prompt (`name` + `description`)
- On-demand loading through the `skill` tool
- Codemini-specific **modes**: `always` / `agent_requested` / `manual`
- Web UI browse toggle: `package` | `context`

Popular community packages often ship **Claude Code hooks** (`hooks/hooks.json`, skill frontmatter `hooks:`). The official [Agent Skills](https://agentskills.io/specification) format does **not** define hooks; hooks are a Claude Code extension (plugin / skill / settings). Codemini has no hook runtime yet.

Claude Code also has **no “always load full SKILL.md”** mode. Closest patterns are `SessionStart` / `UserPromptSubmit` hooks that may return short `additionalContext`, plus progressive disclosure (metadata always visible; body on demand).

## Goals

1. **Compatibility-first (D):** Consume community skills/packages that ship hooks; align event names, config shape, and command I/O with Claude Code where practical.
2. **Common subset first (B+):** Support `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop` with `type: command` handlers; frontmatter and `hooks/hooks.json`.
3. **Remove Codemini modes:** Drop `always` / `agent_requested` / `manual` as runtime drivers; use Claude-aligned activation + optional `disable-model-invocation`.
4. **Skills UI:** Top-level **编码 / 日常** tabs (like Memory / Inbox); within each tab, keep repository/package folding; remove the package/context segmented control.
5. **Editor:** Replace “routing settings” (mode + freeform triggers) with **Hooks options** synced to the supported event list, with zh/en labels via existing i18n.

## Non-goals

- Full Claude Code hook event surface in v1 (no prompt/agent/http/mcp_tool handler types yet).
- Silently merging remote package `.claude/settings.json` hooks into the user’s project.
- Reintroducing always-inject of full skill bodies.
- Removing coding/daily **contexts** (those stay as the UI/runtime dimension).

## Architecture overview

```text
Install / load skill package
  → discover hooks (priority ladder)
  → normalize + record provenance
  → UI: coding|daily tabs, package fold

Session / turn
  → SessionStart / UserPromptSubmit (package or active-skill scoped)
  → Agent may skill() load OR user manually selects skill
  → Skill active ⇒ skill-scoped hooks armed
  → PreToolUse / PostToolUse around tools
  → Stop at turn end ⇒ disarm skill-scoped hooks as appropriate
```

## 1. Information architecture (UI)

### Skills panel

```text
Skills
├── [编码]  [日常]          ← top Tabs (Memory/Inbox pattern)
│     ├── search + all/custom/remote filter (keep)
│     └── package/repo folded list only
│           ├── owner/repo-A
│           └── ungrouped (local creates, etc.)
└── detail / editor
```

Rules:

1. Remove `BROWSE_MODES` (`package` | `context`) segmented control.
2. Top tabs: **coding** | **daily**. A skill appears in a tab if its `contexts` includes that value; `["coding","daily"]` appears in both.
3. Inside each tab, always use existing `groupSkillsByPackage` folding; ungrouped for non-package skills.
4. Editor keeps context (coding / daily / both) and hooks configuration; **no mode control**.
5. Detail may show hook count and provenance badges.

### Editor: Hooks options (replaces routing settings)

- Card title: Hooks / 钩子 (i18n).
- Multi-select events = runtime-supported set (single source of truth table).
- Persist Claude standard English event IDs; UI shows localized labels only.
- Per selected event: optional matcher + command path; write to skill `hooks/hooks.json` and/or frontmatter.
- Toggle: **disable model auto-invocation** (maps to `disable-model-invocation` / equivalent).
- Drop freeform `triggers` as a first-class API (legacy read: ignore for runtime; show deprecation hint).
- Drop priority-as-mode-routing if it only served always-ordering; keep only if still useful for unrelated UI sort (optional, prefer drop if unused).

Example i18n keys:

| Key | EN | ZH |
|-----|----|----|
| `hookEvent_SessionStart` | Session start | 会话开始 |
| `hookEvent_UserPromptSubmit` | On prompt submit | 提交提示时 |
| `hookEvent_PreToolUse` | Before tool use | 工具调用前 |
| `hookEvent_PostToolUse` | After tool use | 工具调用后 |
| `hookEvent_Stop` | When agent stops | Agent 停止时 |

## 2. Activation model (replaces modes)

| Mechanism | Behavior |
|-----------|----------|
| Index | `name` + `description` in system prompt |
| Agent | On-demand `skill({ name \| query })` |
| `disable-model-invocation` | Blocks agent auto-load only |
| **User manual** | UI / slash / explicit select injects body; **never blocked** by disable-model-invocation |
| Standing short constraints | `SessionStart` / `UserPromptSubmit` → `additionalContext` (not full SKILL.md) |

While a skill is active (manual select or successful agent load), its skill-scoped hooks are armed; when inactive, they are removed.

**Manual trigger is independent of agent discovery.** SessionStart/UserPromptSubmit must not cancel, override, or steal a user-selected skill.

### Mode migration

| Legacy | New |
|--------|-----|
| `mode: always` | No full-body inject; suggest SessionStart short context (no silent rewrite; optional guided migrate later) |
| `mode: manual` | `disable-model-invocation: true` |
| `mode: agent_requested` / default | No field needed |
| Freeform `triggers` | Ignored for runtime |

## 3. Hook discovery & remote priority

### Package layout

```text
<package-root>/
  hooks/hooks.json
  .claude-plugin/plugin.json    # optional
  skills/<name>/  OR  <name>/
    SKILL.md                    # optional frontmatter hooks:
    hooks/hooks.json            # preferred for authoring local skills
    scripts/
```

### Priority ladder (high → low)

For the same **skill name + same hook event**, adopt **only the higher-priority source** (no silent deep-merge of command lists). Lower sources for that event are skipped; log + UI note “overridden by higher source”.

| Priority | Source | Notes |
|----------|--------|-------|
| 1 | Skill `SKILL.md` frontmatter `hooks:` | Closest to Claude component-scoped hooks |
| 2 | Skill directory `hooks/hooks.json` | Primary path for self-authored skills |
| 3 | Package root `hooks/hooks.json` (or path from plugin manifest) | Armed when a skill from the package is active (v1 simplification OK) |
| 4 | Package `.claude/settings.json` hooks | **Not loaded by default**; only if user explicitly “Adopt package settings”, still below 1–3 |

Additional rules:

- **Per-event resolution:** frontmatter `PreToolUse` + skill-json `Stop` → keep both.
- **Same source, multiple matchers:** keep all matcher entries from that source.
- **Local edits on update:** default **preserve local hooks** unless user chooses “reset to upstream”.
- Collect all candidates first, then resolve by ladder (avoid install-order races).

### Provenance (runtime metadata)

```json
{
  "skillName": "foo",
  "hooks": { "PreToolUse": [ /* normalized Claude-shaped entries */ ] },
  "hooksProvenance": {
    "PreToolUse": { "source": "frontmatter", "priority": 1 }
  },
  "disableModelInvocation": false
}
```

## 4. Runtime behavior

### Supported events (v1)

| Event | When | Capabilities |
|-------|------|----------------|
| `SessionStart` | Session begin / resume | `additionalContext`; no full skill auto-load |
| `UserPromptSubmit` | After user submit, before model | `additionalContext`; may block |
| `PreToolUse` | Before tool runs (matcher) | allow / deny |
| `PostToolUse` | After successful tool | observe / optional context; does not undo |
| `Stop` | Agent turn end | cleanup / notify |

Handlers: **`type: command` only** in v1.

### Execution conventions

- stdin JSON / stdout JSON / exit codes aligned with Claude Code docs where practical.
- Placeholders: `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_ROOT}` (map to workspace / package install root); Windows/PowerShell-friendly resolution.
- Default **fail-open** on timeout/crash; honor `failClosed: true` when present.
- Emit UI/`onAgentEvent` observability for hook start/end/error.

### Safety

- Remote package hooks install with the skill/package; optional first-run confirmation for executing package hooks can be added in implementation (default TBD in plan: prefer confirm-once for remote).
- Hook scripts are local process execution; do not bypass existing tool approval for agent tools themselves.

## 5. Testing expectations

- Unit: priority ladder (frontmatter beats skill json beats package; settings skipped unless adopted; per-event mix).
- Unit: activation — disable-model-invocation blocks tool auto path, not manual compose path.
- Unit: i18n keys exist for all supported events in `en.js` / `zh.js`.
- Integration: PreToolUse deny blocks tool; SessionStart context appears in prompt composition.
- UI: coding/daily tabs; no browseMode control; package fold still works; dual-context skills in both tabs.
- Migration: legacy mode fields do not change runtime after cutover.

## 6. Open implementation details (for plan, not blockers)

- Exact confirm-once UX for first remote hook execution.
- Whether package-level hooks require any package skill active vs any enabled skill.
- Whether empty selected event without command auto-scaffolds `scripts/<event>.ps1|.sh`.
- Wire format for storing `disable-model-invocation` in `codemini.skills.json` vs frontmatter only.

## Decisions log

| Decision | Choice |
|----------|--------|
| Primary goal | Compatibility with Claude-style skill/package hooks |
| Depth | Common subset + SessionStart |
| Modes | Removed; Claude-aligned activation |
| Always full SKILL.md | Not supported (Claude has no such hook) |
| Manual trigger | Unaffected by disable-model-invocation / SessionStart |
| UI tabs | coding \| daily; remove package/context browse toggle |
| Editor | Hooks multi-select synced to runtime events; zh/en labels |
| Remote settings.json | Opt-in adopt only |
| Conflict policy | Per-event highest priority wins |
