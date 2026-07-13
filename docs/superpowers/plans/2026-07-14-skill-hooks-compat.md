# Skill Hooks Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Claude Code–compatible skill/package hooks (discover + run), remove Codemini skill modes, and rebuild the Skills panel around coding/daily tabs with a hooks editor.

**Architecture:** Pure modules under `src/core/` own hook constants, discovery (priority ladder), and command execution. `chat-runtime.js` / `agent-loop.js` arm hooks for active skills and fire lifecycle events. Web UI (`SkillPanel.jsx`) switches to coding|daily tabs and edits `hooks/hooks.json` + `disable-model-invocation`. Legacy `mode` / `triggers` stop driving runtime.

**Tech Stack:** Node.js ESM, `node:test`, existing Codemini CLI + `codemini-web` React client, new `yaml` dependency for nested frontmatter `hooks:`.

**Spec:** `docs/superpowers/specs/2026-07-14-skill-hooks-compat-design.md`

---

## Resolved open details (from spec §6)

| Topic | Decision for v1 |
|-------|-----------------|
| Remote hook first-run | Config `skills.hooks.confirm_remote: true` (default). First execution of hooks whose provenance is package/settings requires one approval; remembered per package source key. |
| Package-level hooks | Armed when **any skill from that package is active** in the session. |
| Empty event / no command | Allow save; UI warning; runtime no-ops missing commands (fail-open log). No auto-scaffold scripts. |
| `disable-model-invocation` storage | Catalog `codemini.skills.json` field `disableModelInvocation` + optional frontmatter `disable-model-invocation`. Catalog wins when both set. |

---

## File map

| File | Responsibility |
|------|----------------|
| `src/core/skill-hooks-constants.js` | Supported events, source priorities, i18n key helpers |
| `src/core/skill-hooks-normalize.js` | Normalize Claude-shaped hook configs; per-event priority resolve |
| `src/core/skill-hooks-discover.js` | Load frontmatter / skill json / package json / optional settings |
| `src/core/skill-hooks-runner.js` | Spawn command hooks, placeholders, failOpen/failClosed |
| `src/core/skill-hooks-session.js` | Active skill set, armed hook set, SessionStart context buffer |
| `src/commands/skill.js` | On install/update: discover hooks, preserve local on update |
| `src/core/command-loader.js` | Drop mode-based index eligibility; expose disable-model-invocation |
| `src/core/tools.js` | `skill` tool respects disable-model-invocation for agent loads |
| `src/core/chat-runtime.js` | Remove always-skill inject; UserPromptSubmit/SessionStart; arm on manual/agent load |
| `src/core/agent-loop.js` | PreToolUse / PostToolUse / Stop around tool execution |
| `codemini-web/server.js` | Metadata API: hooks + disableModelInvocation; drop mode writes |
| `codemini-web/client/src/components/SkillPanel.jsx` | Tabs + hooks editor |
| `codemini-web/client/i18n/en.js`, `zh.js` | Hook event labels |
| `tests/skill-hooks-*.test.js` | Unit coverage |
| `tests/web-skill-editor-layout.test.js` | Update source assertions |

---

### Task 1: Hook constants + priority resolve (pure)

**Files:**
- Create: `src/core/skill-hooks-constants.js`
- Create: `src/core/skill-hooks-normalize.js`
- Test: `tests/skill-hooks-normalize.test.js`

- [ ] **Step 1: Write failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HOOK_EVENTS,
  HOOK_SOURCE_PRIORITY,
} from '../src/core/skill-hooks-constants.js';
import { resolveHooksByPriority } from '../src/core/skill-hooks-normalize.js';

test('supported events include SessionStart and tool lifecycle', () => {
  for (const name of [
    'SessionStart',
    'UserPromptSubmit',
    'PreToolUse',
    'PostToolUse',
    'Stop',
  ]) {
    assert.ok(HOOK_EVENTS.has(name));
  }
});

test('frontmatter beats skill json beats package for same event', () => {
  const resolved = resolveHooksByPriority([
    {
      source: 'package',
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'pkg.sh' }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'pkg-stop.sh' }] }],
      },
    },
    {
      source: 'skill-json',
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'skill.sh' }] }],
      },
    },
    {
      source: 'frontmatter',
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'fm.sh' }] }],
      },
    },
  ]);
  assert.equal(resolved.hooks.PreToolUse[0].hooks[0].command, 'fm.sh');
  assert.equal(resolved.provenance.PreToolUse.source, 'frontmatter');
  assert.equal(resolved.hooks.Stop[0].hooks[0].command, 'pkg-stop.sh');
  assert.equal(resolved.provenance.Stop.source, 'package');
});

test('settings source ignored unless adoptSettings true', () => {
  const resolved = resolveHooksByPriority(
    [
      {
        source: 'settings',
        hooks: {
          PreToolUse: [{ hooks: [{ type: 'command', command: 'settings.sh' }] }],
        },
      },
    ],
    { adoptSettings: false },
  );
  assert.deepEqual(resolved.hooks, {});
});
```

- [ ] **Step 2: Run tests — expect FAIL (module missing)**

```bash
node --test tests/skill-hooks-normalize.test.js
```

Expected: `ERR_MODULE_NOT_FOUND` or similar.

- [ ] **Step 3: Implement constants + resolve**

`src/core/skill-hooks-constants.js`:

```js
export const HOOK_EVENTS = new Set([
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
]);

/** Lower number = higher priority */
export const HOOK_SOURCE_PRIORITY = {
  frontmatter: 1,
  'skill-json': 2,
  package: 3,
  settings: 4,
};

export function hookEventI18nKey(eventName) {
  return `hookEvent_${eventName}`;
}
```

`src/core/skill-hooks-normalize.js`:

```js
import { HOOK_EVENTS, HOOK_SOURCE_PRIORITY } from './skill-hooks-constants.js';

function normalizeHandler(handler) {
  if (!handler || typeof handler !== 'object') return null;
  if (handler.type && handler.type !== 'command') return null;
  const command = String(handler.command || '').trim();
  if (!command) return null;
  return {
    type: 'command',
    command,
    timeout: Number.isFinite(Number(handler.timeout)) ? Number(handler.timeout) : 30,
    failClosed: handler.failClosed === true,
  };
}

function normalizeMatcherGroup(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const hooks = (Array.isArray(entry.hooks) ? entry.hooks : [])
    .map(normalizeHandler)
    .filter(Boolean);
  if (hooks.length === 0) return null;
  return {
    matcher: entry.matcher == null ? undefined : String(entry.matcher),
    hooks,
  };
}

export function normalizeHooksObject(raw = {}) {
  const out = {};
  for (const [eventName, groups] of Object.entries(raw || {})) {
    if (!HOOK_EVENTS.has(eventName)) continue;
    const list = (Array.isArray(groups) ? groups : [])
      .map(normalizeMatcherGroup)
      .filter(Boolean);
    if (list.length) out[eventName] = list;
  }
  return out;
}

export function resolveHooksByPriority(candidates = [], { adoptSettings = false } = {}) {
  const byEvent = new Map();
  const sorted = [...candidates]
    .filter((c) => c && c.source)
    .filter((c) => adoptSettings || c.source !== 'settings')
    .sort(
      (a, b) =>
        (HOOK_SOURCE_PRIORITY[a.source] ?? 99) - (HOOK_SOURCE_PRIORITY[b.source] ?? 99),
    );

  for (const candidate of sorted) {
    const normalized = normalizeHooksObject(candidate.hooks);
    for (const [eventName, groups] of Object.entries(normalized)) {
      if (byEvent.has(eventName)) continue;
      byEvent.set(eventName, {
        groups,
        source: candidate.source,
        priority: HOOK_SOURCE_PRIORITY[candidate.source],
      });
    }
  }

  const hooks = {};
  const provenance = {};
  for (const [eventName, info] of byEvent) {
    hooks[eventName] = info.groups;
    provenance[eventName] = { source: info.source, priority: info.priority };
  }
  return { hooks, provenance };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
node --test tests/skill-hooks-normalize.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/core/skill-hooks-constants.js src/core/skill-hooks-normalize.js tests/skill-hooks-normalize.test.js
git commit -m "feat(skills): add hook event constants and priority resolver"
```

---

### Task 2: Discover hooks from skill/package paths

**Files:**
- Create: `src/core/skill-hooks-discover.js`
- Modify: `package.json` (add `yaml` dependency)
- Test: `tests/skill-hooks-discover.test.js`

- [ ] **Step 1: Install yaml**

```bash
npm install yaml
```

- [ ] **Step 2: Write failing discover tests** (temp dirs with frontmatter + json)

Use `node:fs/promises` + `os.tmpdir()` fixtures:

- Skill with frontmatter `hooks.PreToolUse` only → source `frontmatter`
- Skill with both frontmatter PreToolUse and `hooks/hooks.json` Stop → both events
- Package root `hooks/hooks.json` when skill has none → source `package`
- `.claude/settings.json` ignored by default

- [ ] **Step 3: Implement discover**

Key API:

```js
export async function discoverSkillHooks({
  skillRoot,
  packageRoot = null,
  adoptSettings = false,
} = {}) { /* read candidates → resolveHooksByPriority */ }

export async function readHooksJson(filePath) { /* JSON parse → normalizeHooksObject */ }

export async function readFrontmatterHooks(skillMdPath) {
  // Parse YAML frontmatter with yaml.parse; return metadata.hooks object or {}
}
```

Frontmatter: split on `---`, `YAML.parse(meta)` from `yaml` package; only keep `hooks` key for candidates; also read `disable-model-invocation` boolean for callers.

- [ ] **Step 4: Tests PASS**

```bash
node --test tests/skill-hooks-discover.test.js
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/core/skill-hooks-discover.js tests/skill-hooks-discover.test.js
git commit -m "feat(skills): discover Claude-style hooks with source priority"
```

---

### Task 3: Command hook runner

**Files:**
- Create: `src/core/skill-hooks-runner.js`
- Test: `tests/skill-hooks-runner.test.js`

- [ ] **Step 1: Failing test** — script that reads stdin JSON and prints `{"decision":"deny"}` / allow; Windows-friendly `node` script fixture (not bash).

```js
test('PreToolUse deny fails closed when failClosed true', async () => {
  const result = await runCommandHook({
    command: `node "${denyFixture}"`,
    timeout: 5,
    failClosed: true,
    input: { hook_event_name: 'PreToolUse', tool_name: 'run' },
    env: {
      CLAUDE_PROJECT_DIR: process.cwd(),
      CLAUDE_PLUGIN_ROOT: process.cwd(),
    },
  });
  assert.equal(result.decision, 'deny');
});

test('timeout fail-open when failClosed false', async () => {
  const result = await runCommandHook({
    command: `node -e "setTimeout(()=>{}, 10000)"`,
    timeout: 0.2,
    failClosed: false,
    input: { hook_event_name: 'Stop' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.failOpen, true);
});
```

- [ ] **Step 2: Implement runner**

- Expand `${CLAUDE_PROJECT_DIR}` / `${CLAUDE_PLUGIN_ROOT}` in command string before spawn.
- On Windows use `shell: true` with PowerShell-safe quoting only when needed; prefer `execFile` with `node` fixtures in tests.
- Parse stdout JSON for `decision`, `reason`, `hookSpecificOutput.additionalContext`, `systemMessage`.
- Exit code `2` ⇒ deny (Claude-like); other non-zero ⇒ failOpen unless `failClosed`.

- [ ] **Step 3: Tests PASS + commit**

```bash
git add src/core/skill-hooks-runner.js tests/skill-hooks-runner.test.js
git commit -m "feat(skills): run command hooks with Claude-like I/O"
```

---

### Task 4: Session hook registry

**Files:**
- Create: `src/core/skill-hooks-session.js`
- Test: `tests/skill-hooks-session.test.js`

- [ ] **Step 1: API + tests**

```js
export function createSkillHooksSession() {
  return {
    activeSkills: new Map(), // name -> { hooks, provenance, packageKey, pluginRoot }
    sessionStartContexts: [],
    remoteConfirmedPackages: new Set(),
  };
}

export function armSkillHooks(session, skillEntry) { /* set activeSkills */ }
export function disarmSkillHooks(session, skillName) { /* delete */ }
export function listArmedHandlers(session, eventName) { /* flatten active + matching */ }
export function matcherAllows(matcher, toolName) {
  if (!matcher) return true;
  try {
    return new RegExp(matcher).test(String(toolName || ''));
  } catch {
    return String(toolName || '') === matcher;
  }
}
```

- [ ] **Step 2: Implement + PASS + commit**

```bash
git commit -m "feat(skills): session registry for armed skill hooks"
```

---

### Task 5: Install/update discovers and preserves hooks

**Files:**
- Modify: `src/commands/skill.js` (`installSkill`, `updateSkillPackage`)
- Test: extend `tests/skill-command.test.js` or add `tests/skill-hooks-install.test.js`

- [ ] **Step 1: On `installSkill`**, after copying skill dir, call `discoverSkillHooks({ skillRoot, packageRoot })` and write sidecar `hooks.resolved.json` under skill root **or** store summary in catalog entry:

```js
await upsertSkillCatalogEntry(baseDir, folderName, {
  disableModelInvocation: Boolean(frontmatter['disable-model-invocation']),
  hooksProvenance: discovered.provenance,
  // do not duplicate full hooks blobs if files already on disk
});
```

Prefer **files on disk as source of truth**; catalog only stores `disableModelInvocation` + optional provenance cache.

- [ ] **Step 2: On update**, if local `hooks/hooks.json` or frontmatter hooks differ from upstream and user did not pass `resetHooks: true`, keep local hooks files (copy skill body but skip overwriting hooks paths).

- [ ] **Step 3: Test install from fixture package with `hooks/hooks.json` → discoverable after install.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(skills): discover hooks on install and preserve local hooks on update"
```

---

### Task 6: Remove always-mode injection; honor disable-model-invocation

**Files:**
- Modify: `src/core/command-loader.js` — `isSkillIndexEligible` should not require non-manual mode; treat all non-disabled skills as index-eligible except when explicitly hidden later.
- Modify: `src/core/chat-runtime.js` — remove `getAlwaysSkillCommands` / `buildAlwaysSkillPromptBlock` injection path (or make them always return empty); stop `skill:always` events.
- Modify: `src/core/tools.js` — in `skill` handler, if loading by name and `disableModelInvocation` / metadata flag true, return error for agent path:

```js
if (command.metadata?.disableModelInvocation === true || command.metadata?.['disable-model-invocation'] === true) {
  return {
    error: `Skill "${command.name}" disables model invocation. Ask the user to select it manually.`,
  };
}
```

`skill({name:"list"})` and `query` may still **list** the skill (discovery), but not load content — or omit from list; prefer **list with flag, block load**.

- [ ] **Step 1: Tests** in `tests/skill-hooks-activation.test.js`:
  - always mode skill no longer appears as injected system block helper
  - skill tool load blocked when disableModelInvocation true
  - `composeSelectedSkills` / manual path still loads content (does not use skill tool gate)

- [ ] **Step 2: Implement + PASS**

```bash
node --test tests/skill-hooks-activation.test.js tests/default-system-prompt.test.js
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(skills): drop always-mode inject; gate agent skill load via disable-model-invocation"
```

---

### Task 7: Wire SessionStart + UserPromptSubmit in chat-runtime

**Files:**
- Modify: `src/core/chat-runtime.js` (`createChatRuntime` / `executeSubmission` / session create)
- Modify: `src/core/system-prompt-composer.js` only if extra context needs a dedicated slot (prefer appending via `extraPrompts` / `skillsPrompt`)

- [ ] **Step 1:** When runtime/session starts, create `skillHooksSession` on runtime closure state.

- [ ] **Step 2:** `SessionStart`: for enabled package hooks that are session-scoped… **v1:** run SessionStart handlers from skills that are already active (manual sticky) plus none by default; also allow package SessionStart only after adopt — keep simple: run SessionStart for hooks armed at session start (usually empty) and collect `additionalContext` into `sessionStartContexts`.

- [ ] **Step 3:** At `executeSubmission` start, before `askModel`:
  1. Arm hooks for `options.selectedSkillNames` / composed skills (manual).
  2. Fire `UserPromptSubmit` for armed handlers; if decision deny → return system error to user without calling model.
  3. Append any `additionalContext` into system prompt via `composeSystemPrompt({ extraPrompts: [...] })`.

- [ ] **Step 4: When `skill` tool returns content successfully, `armSkillHooks` for that skill (load discovered hooks from skill root).

- [ ] **Step 5: Tests with stubbed runner (inject `runCommandHook` dependency if needed) asserting deny blocks submit.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(skills): fire SessionStart and UserPromptSubmit hooks in chat runtime"
```

---

### Task 8: Wire PreToolUse / PostToolUse / Stop in agent-loop

**Files:**
- Modify: `src/core/agent-loop.js`
- Modify: `src/core/chat-runtime.js` to pass `skillHooksSession` + `runHooks` into agent loop options

- [ ] **Step 1:** Before executing an approved tool call (after approval gate, before `handler(...)`), run armed `PreToolUse` handlers where `matcherAllows(matcher, toolName)`. On deny → set tool result error, skip execution.

- [ ] **Step 2:** After successful tool result, run `PostToolUse` (fail-open).

- [ ] **Step 3:** When agent loop finishes a turn (before return), run `Stop` handlers; optionally disarm non-manual skills (keep manual-selected armed until user clears selection — v1: keep armed until session end).

- [ ] **Step 4: Emit `onAgentEvent({ type: 'hook:start'|'hook:end'|'hook:error', event, skillName })`.

- [ ] **Step 5: Tests** — unit-level with mocked handlers map if full loop is heavy; or focused helper `applyPreToolUseHooks(...)`.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(skills): integrate PreToolUse PostToolUse Stop into agent loop"
```

---

### Task 9: Web API metadata for hooks + disableModelInvocation

**Files:**
- Modify: `codemini-web/server.js` — `normalizeSkillMetadataPatch`, create/metadata routes
- Modify: list skills payload to include `disableModelInvocation`, `hooksProvenance`, `hookEvents` (keys present)

- [ ] **Step 1:** Extend patch normalizer:

```js
if (input.disableModelInvocation !== undefined) {
  out.disableModelInvocation = input.disableModelInvocation === true;
}
if (input.hooks !== undefined && input.hooks && typeof input.hooks === 'object') {
  // write through to skill hooks/hooks.json via helper; do not store full hooks in catalog
}
```

- [ ] **Step 2:** Add `PUT /api/skills/:name/hooks` body `{ hooks: { PreToolUse: [...] } }` writing `hooks/hooks.json` under skill root (skill-json source).

- [ ] **Step 3:** Stop requiring/writing `mode` on create (omit or ignore). Map legacy `mode: manual` reads → `disableModelInvocation: true` in list API for migration display once.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(web): skill metadata API for hooks and disableModelInvocation"
```

---

### Task 10: Skills UI — coding/daily tabs + package fold only

**Files:**
- Modify: `codemini-web/client/src/components/SkillPanel.jsx`
- Modify: `tests/web-skill-editor-layout.test.js`
- Modify: `codemini-web/client/i18n/en.js`, `zh.js`

- [ ] **Step 1:** Remove `BROWSE_MODES` / `browseMode` state and the segmented control.

- [ ] **Step 2:** Wrap panel like MemoryDialog:

```jsx
<Tabs value={contextTab} onValueChange={setContextTab}>
  <TabsList>
    <TabsTrigger value="coding">{t('skillContextCoding')}</TabsTrigger>
    <TabsTrigger value="daily">{t('skillContextDaily')}</TabsTrigger>
  </TabsList>
  <TabsContent value={contextTab}>...</TabsContent>
</Tabs>
```

- [ ] **Step 3:** Filter `filteredSkills` with `contexts.includes(contextTab)` (default both if missing).

- [ ] **Step 4:** Always render `packageGroupedSkills` list (never context grouped list).

- [ ] **Step 5:** Update source tests: assert no `skillBrowse_`, assert `TabsTrigger` coding/daily present.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(web): skills panel coding/daily tabs with package folding"
```

---

### Task 11: Skills editor — Hooks options UI (zh/en)

**Files:**
- Modify: `SkillPanel.jsx` (`SkillEditor`, routing card, batch dialog)
- Modify: i18n files

- [ ] **Step 1:** Replace mode segmented control + triggers inputs with:
  - Switch `disableModelInvocation`
  - Checklist of `HOOK_EVENTS` using `t(hookEventI18nKey(name))`
  - For each checked event: matcher input + command input
  - On save: `api.updateSkillHooks(name, hooks)` + metadata disable flag

- [ ] **Step 2:** Add i18n keys from spec table to `en.js` / `zh.js`; rename `skillRoutingSettings` → `skillHooksSettings` ("Hooks" / "钩子").

- [ ] **Step 3:** Remove batch-edit mode selector or replace with hooks note (“edit hooks per skill”).

- [ ] **Step 4: Source/layout tests updated.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(web): replace skill routing mode UI with localized hooks options"
```

---

### Task 12: Client API helpers + verify AGENTS.md pointer

**Files:**
- Modify: `codemini-web/client/src/hooks/use-api.js` (or equivalent) — `updateSkillHooks`
- Modify: `AGENTS.md` — one line under Task Routing: skill hooks → `src/core/skill-hooks-*.js`

- [ ] **Step 1: Implement API client method**

- [ ] **Step 2: Commit**

```bash
git commit -m "docs: point AGENTS.md at skill hooks modules; add hooks API client"
```

---

### Task 13: Verification sweep

- [ ] **Step 1: Run focused tests**

```bash
node --test tests/skill-hooks-normalize.test.js tests/skill-hooks-discover.test.js tests/skill-hooks-runner.test.js tests/skill-hooks-session.test.js tests/skill-hooks-activation.test.js tests/web-skill-editor-layout.test.js tests/skill-display.test.js
```

Expected: all PASS.

- [ ] **Step 2: Run broader suite**

```bash
npm test
```

Fix any fallout from always-skill / mode assumptions in older tests.

- [ ] **Step 3: Final commit if fixes needed**

```bash
git commit -m "test: fix fallout from skill hooks and mode removal"
```

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| Hook events B+ SessionStart | 1, 3, 7, 8 |
| Priority ladder + settings opt-in | 1, 2 |
| Install discover / update preserve | 5 |
| Remove modes / no always full body | 6 |
| disable-model-invocation; manual OK | 6, 7, 11 |
| Runtime Pre/Post/Stop + prompt hooks | 7, 8 |
| coding/daily tabs; remove browse toggle | 10 |
| Hooks editor + zh/en | 11 |
| Provenance | 2, 5, 9 |
| Tests listed in spec | 1–8, 10, 13 |

## Self-review notes

- No TBD left in resolved open details.
- Frontmatter nested hooks require `yaml` (Task 2) — called out explicitly.
- Runner uses Node fixtures for Windows-first CI.
- Package SessionStart without active skills intentionally minimal in Task 7 to avoid global surprise hooks.
