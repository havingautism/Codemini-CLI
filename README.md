# [CodeMini CLI](https://github.com/havingautism/Codemini-CLI)

[![npm version](https://img.shields.io/npm/v/codemini-cli.svg?style=flat-square)](https://www.npmjs.com/package/codemini-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node.js >= 22](https://img.shields.io/badge/Node.js-%3E%3D%2022-339933.svg?style=flat-square&logo=node.js)](https://nodejs.org)
[![English](https://img.shields.io/badge/README-English-0f172a?style=for-the-badge)](#english)
[![简体中文](https://img.shields.io/badge/README-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-2563eb?style=for-the-badge)](#简体中文)

---

<a id="english"></a>

## English

CodeMini CLI is a terminal coding assistant built for teams that want a sharper, more controllable, and model-agnostic agent experience.

It is designed around a deliberate idea: most coding workflows do not need a huge default tool surface or unrestricted shell behavior. Instead, CodeMini starts with a compact core, loads advanced tools on demand, and keeps the agent grounded in structured code operations, session todos, lightweight project indexing, and shell-aware safety rules.

**Contents** — [Why CodeMini CLI](#why-codemini-cli) · [Installation](#installation) · [Quick Start](#quick-start) · [Web UI](#web-ui) · [Commands](#commands) · [Personalities (Souls)](#personalities-souls) · [Tool Model](#how-the-tool-model-works) · [Core Capabilities](#core-capabilities) · [Reflect Skills](#reflect-skills) · [Dream Loop (Built-in Memory Evolution)](#dream-loop-built-in-memory-evolution) · [Project Index](#project-index) · [Good Fit](#good-fit) · [Documentation](#documentation) · [Development](#development) · [License](#license)

### Why CodeMini CLI

- Built for practical coding workflows across both frontier-scale and smaller/internal models
- Keeps the default tool list intentionally small, with additional tools discoverable through `tool_search`
- Treats Windows and PowerShell as first-class environments instead of Linux-only afterthoughts
- Prefers structured file and code tools over noisy shell fallbacks
- Supports planning, execution, todo tracking, and sub-agent workflows without forcing a bloated interface

### Installation

Requires **Node.js ≥ 22**.

```bash
# Install globally
npm install -g codemini-cli

# Or run without installing
npx codemini-cli
```

### Quick Start

```bash
# 1. Configure your gateway and model
codemini config set gateway.base_url http://your-internal-gateway/v1
codemini config set gateway.api_key your_token
codemini config set model.name your-preferred-model

# 2. Set shell (PowerShell for Windows, bash for macOS/Linux)
codemini config set shell.default powershell   # Windows
codemini config set shell.default bash         # macOS / Linux

# 3. Optional: set reply language and run diagnostics
codemini config set ui.reply_language zh
codemini doctor

# 4. Start an interactive coding session
codemini
```

### Web UI

CodeMini also includes a local Web UI under `codemini-web/`. It runs the same CodeMini runtime behind a browser interface, so you can keep the agent workflow visible while managing sessions, projects, approvals, skills, souls, and CodeWiki reports from one place.

After installing the npm package, open it directly from any project:

```bash
codemini --web

# Equivalent forms
codemini web
codemini -web
```

Useful options:

```bash
codemini --web --port 3210 --project /path/to/project
codemini --web --session <session-id> --model <model-name> --no-open
```

For local Web UI development:

```bash
cd codemini-web
bun install
bun run dev
```

The dev script starts two local services and prints the exact URLs:

- Web app: `http://127.0.0.1:5178` by default, or the next free port
- API server: `http://127.0.0.1:5000` by default, or the next free port

For a single built/served process:

```bash
cd codemini-web
npm run build
npm run start -- --port 3210
```

Current Web UI highlights:

- Chat with the CodeMini runtime using the same sessions and configuration as the CLI
- Switch projects and sessions without restarting the process
- Review tool approvals and plan approvals in focused dialogs/cards
- Manage config, skills, and soul presets from the browser
- Browse CodeWiki / project-requirements reports, generate new reports, ask questions about them, and delete stale reports
- See runtime status, active mode, git branch, version/update state, and live execution progress

### Optional: FFF Search Acceleration

CodeMini CLI can optionally use `fff-mcp` as a faster backend for `grep`, `glob`, and part of `list`.

- If `fff-mcp` is installed and available in `PATH`, CodeMini will reuse it automatically within the current session.
- If `fff-mcp` is missing or fails to start, CodeMini falls back to its built-in search implementation automatically.
- This means `fff-mcp` is an enhancement, not a hard dependency.
- `codemini doctor` now reports `FFF MCP availability` so you can verify whether it is active.

### Optional: Playwright Web Rendering

`web_fetch` uses a lightweight `fetch` + HTML parser path by default, so Playwright is not installed as a default dependency.

For JavaScript-rendered pages, install Playwright separately to enable richer browser-rendered fallback:

```bash
npm install -g playwright
playwright install chromium
```

### Commands

| Command | Description |
|---------|-------------|
| `codemini [prompt]` | Start an interactive coding session with an optional initial prompt |
| `codemini chat [prompt]` | Chat mode — single-turn or multi-turn conversation |
| `codemini run <task>` | Run a task non-interactively (e.g. `codemini run "fix the login bug"`) |
| `codemini run --harness <role> <task>` | Run a task with a specific sub-agent role (e.g. `coder`, `planner`, `reviewer`) |
| `codemini run --pipeline <task>` | Run a task through the full planning → coding → review pipeline |
| `codemini run <task> --max-steps N` | Limit the maximum number of agent steps for a run task |
| `codemini run <task> --model <name>` | Override the default model for a single run |
| `codemini [prompt] --plain` | Disable TUI and use plain terminal output |
| `codemini config set\|get\|list <key> [value]` | Manage configuration (gateway, model, shell, UI, soul, etc.) |
| `codemini doctor` | Run environment diagnostics and validate configuration |
| `codemini skill list\|install\|enable\|disable\|inspect\|reindex` | Manage skills — list, install, toggle, or inspect bundled/third-party skills |

### Personalities (Souls)

CodeMini CLI supports swappable "soul" personalities that change tone and expression style without altering plan logic or code behavior.

Built-in souls: `default`, `professional`, `ceo`, `playful`, `anime`, `caveman`, `pirate`

```bash
codemini config set soul.preset playful
```

### Built-in Skills

Skills are reusable workflow patterns that guide how the agent approaches different types of tasks. They are loaded automatically when applicable.

| Skill | Trigger | Description |
|-------|---------|-------------|
| **superpowers-lite** | Default for all coding work | Lightweight operating style: prefer structured tools, keep context tight, use sub-agents, verify before claiming success; asks 1-3 sharp questions only for high-risk decisions |
| **grill-me** | Explicit pressure-test requests | Optional scrutiny mode for plans, PRs, launches, and ideas; challenges assumptions without changing the default workflow |
| **brainstorm** | Multiple reasonable approaches exist | Explores options and tradeoffs before coding; asks one question at a time to resolve uncertainty |
| **writing-plans** | Non-trivial implementation task | Creates a step-by-step plan with exact file paths, code, and verification steps before touching code |

Skills are installed and managed via `codemini skill`:

```bash
codemini skill list                         # List builtin, project, and global skills
codemini skill install <path>               # Install to .codemini/skills by default
codemini skill install --scope=global <path> # Install to the global skills directory
codemini skill inspect <name>               # Inspect a skill's details
```

Bundled skills are built in, always enabled, and cannot be disabled or overwritten. Third-party skills live either in the project at `.codemini/skills/<name>/SKILL.md` or globally at `<base-config-dir>/skills/<name>/SKILL.md`, matching `/reflect`.

### How The Tool Model Works

CodeMini CLI intentionally separates tools into two layers:

- **Default tools** — always visible, optimized for the most common coding path
- **Deferred tools** — loaded only when needed through `tool_search`

This keeps the main interface smaller and makes the agent's first-choice behavior more predictable.

Typical flow:

1. `query_project_index` or `list` to orient
2. `read` and `grep` to inspect
3. `edit` or `write` to change code
4. `run` to verify
5. `update_todos` to keep complex work legible
6. `tool_search` only when a more specialized capability is needed

### Core Capabilities

- Compact default tools for daily work:
  - `read`, `grep`, `glob`, `list`, `query_project_index`
  - `edit`, `write`
  - `read_plan`, `update_plan`, `update_todos`
  - `run`, `tool_search`
- On-demand tools for advanced workflows:
  - AST tools: `ast_query`, `read_ast_node`
  - background task management tools
  - persistent memory tools
  - dream loop tools: `capture_memory`, `dream_consolidate`
- Session-level todo checklists via `update_todos`, rendered natively in the TUI
- Unified shell execution model:
  - one-off commands via `run`
  - long-running commands via `run` with `run_in_background=true`
- Lightweight project index under `.codemini/`
- Tree-sitter based structured editing for function, class, and method-level changes
- Reply language control via `ui.reply_language`
- Safe mode enabled by default

### Reflect Skills

`/reflect` turns a successful workflow from the current session into a reviewed, reusable `SKILL.md` draft.

It is separate from the dream loop: reflect creates a skill draft, waits for review, and writes only after approval. It does not write inbox memories or run dream consolidation.

Common forms:

```text
/reflect
/reflect <what to preserve>
/reflect --scope=global <what to preserve>
```

- `/reflect` is exploratory. CodeMini reviews recent context and proposes a skill only when there is a reusable pattern worth saving.
- `/reflect <what to preserve>` is directed. Use it when you already know which successful chain should become a skill, such as `/reflect preserve the provider tool-call recovery workflow`.
- `/reflect --scope=global <request>` writes the approved draft to the global skills directory instead of the current project.
- The draft is previewed first. Use `/yes` to write it, `/edit <feedback>` to revise it, or `/no` to discard it.

Approved skills are written to the same locations used by third-party skill install:

- Project scope: `.codemini/skills/<skill-name>/SKILL.md`
- Global scope: `<base-config-dir>/skills/<skill-name>/SKILL.md`

### Dream Loop (Built-in Memory Evolution)

Dream loop is built into the runtime as native tools and slash commands (not a skill-only workflow).

What goes into inbox vs persistent memory:

- Inbox (`memory/inbox/...`) stores raw, recent, event-level signal captured during work.
- Typical inbox entries: user corrections, repeated failures, stable preferences, workflow wins, capability gaps, and decisions.
- Inbox is intentionally noisy and temporary; entries are reviewed by consolidation before promotion.
- User memory stores user-specific stable preferences and habits that should follow the user across repos.
- Global memory stores stable cross-task learnings and generally reusable rules.
- Project memory stores repo-specific conventions, workflows, and constraints tied to one codebase.
- Archive (`memory/archive/...`) keeps rejected/superseded evidence instead of silently deleting it.

- Capture signal during active work:
  - Tool: `capture_memory`
  - Slash: `/capture <summary> [--scope global|repo|thread] [--type observation|correction|failure|preference|pattern|win|gap|decision]`
- Inspect inbox:
  - Slash: `/inbox [since-YYYY-MM-DD]`
- Consolidate inbox into long-term/project memory:
  - Tool: `dream_consolidate`
  - Slash: `/dream [--dry-run] [--scope=global|repo|thread]`

Execution mode behavior:

- `execution.mode=auto`: dream tools run normally, and auto-dream can trigger when `memory.auto_dream_threshold` is reached.
- `execution.mode=plan`: model-planned tool calls are not executed, but slash command `/dream` still executes directly in runtime.

### Project Index

CodeMini CLI maintains a lightweight project index inside `.codemini/`:

- `project-map.json` — high-level repository facts such as languages, source roots, test roots, and entry candidates
- `file-index.json` — per-file structure such as imports, exports, functions, classes, and lightweight symbol hints

The index is initialized when entering a project and refreshed incrementally after edits, writes, and patches. It is intended to be factual, compact, and inexpensive to keep current.

<details>
<summary>Data Layout &amp; Config Paths</summary>

- Global session state: `<base-config-dir>/sessions/`
- Project workspace state: `.codemini/`
- Lightweight project index: `.codemini/`
- Bundled repo skills: `skills/<name>/SKILL.md`
- Project-scoped skills: `.codemini/skills/<name>/SKILL.md`
- Global installed skills: `<base-config-dir>/skills/<name>/SKILL.md`

Base config directory resolution order:

| Platform | Path |
|----------|------|
| `CODEMINI_GLOBAL_DIR` env | `$CODEMINI_GLOBAL_DIR` (highest priority) |
| Windows | `%APPDATA%\codemini-global\` |
| macOS | `~/Library/Preferences/codemini-global` |
| Linux / XDG | `$XDG_CONFIG_HOME/codemini-global` |
| Restricted fallback | `.codemini-global/` |

</details>

### Good Fit

CodeMini CLI is a strong fit if you want:

- a coding CLI that behaves well with both large and small models
- a controlled tool surface instead of an everything-is-exposed agent
- Windows and PowerShell support that feels intentional
- a TUI that shows plans, todos, tools, and progress clearly
- a code assistant that prefers structured operations over shell noise

### Documentation

- Operator guide and workflow notes: [OPERATIONS.md](./OPERATIONS.md)
- Packaging and deployment: [deployment.md](./deployment.md)
- Changelog: [Releases](https://github.com/havingautism/Codemini-CLI/releases)

### Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Start locally
npm start
```

### License

[MIT](LICENSE)

---

<a id="简体中文"></a>

## 简体中文

CodeMini CLI 是一个面向真实开发环境的终端代码助手，目标不是"把所有能力都塞进默认界面"，而是做一个更克制、更清晰、更容易掌控的 coding agent CLI。

它围绕一个很明确的原则来设计：默认工具面尽量小，常用路径尽量顺，复杂能力按需加载。这样可以同时兼顾大模型与小模型，也适合团队在内部环境里做稳定、可控的日常开发协作。

### 为什么是它

- 面向大小模型协同的工作流优化：既不默认依赖超大模型，也不牺牲大模型能力上限
- 默认工具面刻意精简，需要更高级能力时再通过 `tool_search` 加载
- 把 Windows 和 PowerShell 当作一等公民来支持
- 优先走结构化代码工具，而不是让模型长期泡在嘈杂 shell 输出里
- 同时支持规划、执行、待办追踪和 sub-agent 协作，但不把界面做得臃肿

### 安装

需要 **Node.js ≥ 22**。

```bash
# 全局安装
npm install -g codemini-cli

# 或不安装直接运行
npx codemini-cli
```

### 快速开始

```bash
# 1. 配置网关和模型
codemini config set gateway.base_url http://your-internal-gateway/v1
codemini config set gateway.api_key your_token
codemini config set model.name your-preferred-model

# 2. 设置 shell（Windows 用 PowerShell，macOS/Linux 用 bash）
codemini config set shell.default powershell   # Windows
codemini config set shell.default bash         # macOS / Linux

# 3. 可选：设置回复语言，运行诊断
codemini config set ui.reply_language zh
codemini doctor

# 4. 启动交互式编码会话
codemini
```

### Web UI

CodeMini 也内置了一个本地 Web UI，位于 `codemini-web/`。它复用同一套 CodeMini runtime，只是把交互入口放到浏览器里，适合更直观地查看会话、项目、审批、技能、人格和 CodeWiki 报告。

npm 包安装后，可以在任意项目目录直接打开：

```bash
codemini --web

# 等价写法
codemini web
codemini -web
```

常用参数：

```bash
codemini --web --port 3210 --project /path/to/project
codemini --web --session <session-id> --model <model-name> --no-open
```

本地开发 Web UI：

```bash
cd codemini-web
bun install
bun run dev
```

开发脚本会启动两个本地服务，并在终端打印实际地址：

- Web 应用：默认 `http://127.0.0.1:5178`，如果端口占用会自动寻找下一个可用端口
- API 服务：默认 `http://127.0.0.1:5000`，如果端口占用会自动寻找下一个可用端口

如果想使用构建后的单进程服务：

```bash
cd codemini-web
npm run build
npm run start -- --port 3210
```

当前 Web UI 重点能力：

- 使用和 CLI 相同的会话、配置与运行时进行对话
- 在浏览器里切换项目和历史会话
- 通过弹窗/卡片审阅 tool approval 和 plan approval
- 管理配置、skills 和 soul 人格预设
- 浏览 CodeWiki / project-requirements 报告，生成新报告，基于报告提问，并删除过期报告
- 查看运行状态、执行模式、git 分支、版本更新状态和实时执行进度

### 可选：FFF 搜索加速

CodeMini CLI 可以可选地使用 `fff-mcp` 作为 `grep`、`glob` 和部分 `list` 的更快后端。

- 如果 `fff-mcp` 已安装并且在 `PATH` 中可用，CodeMini 会在当前会话内自动复用它。
- 如果 `fff-mcp` 缺失或启动失败，CodeMini 会自动回退到内置搜索实现。
- 这意味着 `fff-mcp` 是增强项，不是硬依赖。
- 现在可以通过 `codemini doctor` 里的 `FFF MCP availability` 看到它是否可用。

### 可选：Playwright 网页渲染

`web_fetch` 默认使用轻量的 `fetch` + HTML 解析路径，因此 Playwright 不再作为默认依赖安装。

如果经常读取 JavaScript 渲染页面，可以单独安装 Playwright，让 `web_fetch` 在需要时回退到浏览器渲染：

```bash
npm install -g playwright
playwright install chromium
```

### 命令概览

| 命令 | 说明 |
|------|------|
| `codemini [prompt]` | 启动交互式编码会话，可附带初始提示 |
| `codemini chat [prompt]` | 对话模式——单轮或多轮 |
| `codemini run <task>` | 非交互式执行任务（如 `codemini run "修复登录 bug"`） |
| `codemini run --harness <role> <task>` | 以指定 sub-agent 角色执行任务（如 `coder`、`planner`、`reviewer`） |
| `codemini run --pipeline <task>` | 通过完整计划→编码→审查流水线执行任务 |
| `codemini run <task> --max-steps N` | 限制单次执行的最大 agent 步数 |
| `codemini run <task> --model <name>` | 单次执行时覆盖默认模型 |
| `codemini [prompt] --plain` | 禁用 TUI，使用纯文本终端输出 |
| `codemini config set\|get\|list <key> [value]` | 管理配置（网关、模型、shell、UI、soul 等） |
| `codemini doctor` | 运行环境诊断并验证配置 |
| `codemini skill list\|install\|enable\|disable\|inspect\|reindex` | 管理 skill——列表、安装、启用/禁用、检查 |

### 个性人格（Souls）

CodeMini CLI 支持可切换的 "soul" 人格，仅改变语气和表达风格，不影响计划逻辑或代码行为。

内置人格：`default`、`professional`、`ceo`、`playful`、`anime`、`caveman`、`pirate`

```bash
codemini config set soul.preset playful
```

### 内置 Skills

Skill 是可复用的工作流模式，指导 agent 如何处理不同类型的任务。适用时会自动加载。

| Skill | 触发条件 | 说明 |
|-------|----------|------|
| **superpowers-lite** | 所有编码工作的默认 skill | 轻量操作风格：优先结构化工具、保持上下文精简、使用 sub-agent、验证后再报告完成；仅在高风险决策中提出 1-3 个尖锐问题 |
| **grill-me** | 明确要求压力测试或拷问时 | 可选审查模式，用于方案、PR、发布和想法；挑战假设但不改变默认协作流程 |
| **brainstorm** | 存在多种合理方案时 | 在编码前探索选项和权衡；每次只问一个问题来消除不确定性 |
| **writing-plans** | 非平凡的实现任务 | 在动手之前创建包含精确文件路径、代码和验证步骤的分步计划 |

通过 `codemini skill` 管理技能：

```bash
codemini skill list                          # 列出内置、项目级、全局 skill
codemini skill install <path>                # 默认安装到 .codemini/skills
codemini skill install --scope=global <path> # 安装到全局 skills 目录
codemini skill inspect <name>                # 查看某个 skill 的详细信息
```

内置 skill 是运行时能力，默认启用，不能禁用或被同名第三方 skill 覆盖。第三方 skill 分为项目级 `.codemini/skills/<name>/SKILL.md` 和全局 `<base-config-dir>/skills/<name>/SKILL.md`，与 `/reflect` 的写入位置一致。

### 工具模型怎么设计

CodeMini CLI 把工具分成两层：

- **默认工具** — 永远可见，覆盖最常见的编码主路径
- **延迟工具** — 只有在需要时才通过 `tool_search` 加载

这样做的目标，是让主界面更小、更稳，也让模型在第一反应时更容易走对路径。

典型流程：

1. `query_project_index` 或 `list` 做定位
2. `read` 和 `grep` 做理解
3. `edit` 或 `write` 做改动
4. `run` 做验证
5. `update_todos` 追踪复杂任务
6. 真的需要专门能力时，再 `tool_search`

### 核心能力

- 默认主工具保持在高频主路径：
  - `read`、`grep`、`glob`、`list`、`query_project_index`
  - `edit`、`write`
  - `read_plan`、`update_plan`、`update_todos`
  - `run`、`tool_search`
- 更专业的能力按需加载：
  - AST 工具：`ast_query`、`read_ast_node`
  - 后台任务管理工具
  - 持久 memory 工具
  - dream loop 工具：`capture_memory`、`dream_consolidate`
- 通过 `update_todos` 维护复杂单任务的会话级待办清单，并直接渲染在 TUI 中
- 统一的 shell 执行模型：
  - 一次性命令直接 `run`
  - 长运行命令通过 `run` + `run_in_background=true`
- 在 `.codemini/` 下维护轻量项目索引，帮助模型更快理解仓库
- 基于 Tree-sitter 的结构化编辑能力，适合函数级、类级、方法级改动
- 支持通过 `ui.reply_language` 控制回复语言
- safe mode 默认开启

### Reflect Skills（复盘沉淀 Skill）

`/reflect` 可以把当前会话中已经跑通的成功链路沉淀成一个可审阅、可复用的 `SKILL.md` 草稿。

它和 dream loop 是分开的：reflect 只生成 skill 草稿，先让用户审阅，确认后才写文件；不会写入 inbox，也不会触发 dream consolidation。

常用形式：

```text
/reflect
/reflect <要沉淀的用户要求>
/reflect --scope=global <要沉淀的用户要求>
```

- `/reflect` 是探索模式。CodeMini 会查看近期上下文，只有在确实有可复用模式时才提出 skill 草稿。
- `/reflect <用户要求>` 是定向模式。适合你已经知道要沉淀哪条成功链路，例如 `/reflect 把刚才 provider tool_call 恢复链路沉淀成 skill`。
- `/reflect --scope=global <用户要求>` 会把确认后的草稿写到全局 skill 目录，而不是当前项目。
- 草稿会先预览。用 `/yes` 写入，用 `/edit <反馈>` 修改，用 `/no` 放弃。

确认后的 skill 写入位置和第三方 skill 安装保持一致：

- 项目级：`.codemini/skills/<skill-name>/SKILL.md`
- 全局级：`<base-config-dir>/skills/<skill-name>/SKILL.md`

### Dream Loop（内置记忆演化）

Dream loop 是运行时内置能力，不依赖 skill 才能使用。

Inbox 和持久记忆的区别：

- Inbox（`memory/inbox/...`）保存的是工作过程中的原始事件信号，强调“先记下来”。
- 典型 inbox 条目：用户纠正、重复失败、稳定偏好、流程收益、能力缺口、关键决策。
- Inbox 本质上是临时且可能带噪的，需经 consolidation 审核后再晋升。
- User memory 保存“跟这个用户长期相关”的稳定偏好与习惯，可跨仓库复用。
- Global memory 保存跨任务可复用的稳定经验或规则。
- Project memory 保存特定仓库的约定、流程和约束。
- Archive（`memory/archive/...`）用于保留被拒绝/被覆盖证据，而不是静默删除。

- 在工作中捕获高信号：
  - 工具：`capture_memory`
  - 斜杠命令：`/capture <summary> [--scope global|repo|thread] [--type observation|correction|failure|preference|pattern|win|gap|decision]`
- 查看 inbox：
  - 斜杠命令：`/inbox [since-YYYY-MM-DD]`
- 把 inbox 整理进长期/项目记忆：
  - 工具：`dream_consolidate`
  - 斜杠命令：`/dream [--dry-run] [--scope=global|repo|thread]`

执行模式差异：

- `execution.mode=auto`：dream 工具可正常执行；当达到 `memory.auto_dream_threshold` 时可自动触发 consolidation。
- `execution.mode=plan`：模型规划出的工具调用不会执行，但 `/dream` 作为运行时命令仍可直接执行。

### 项目索引

CodeMini CLI 会在 `.codemini/` 下维护一份轻量项目索引：

- `project-map.json` — 记录仓库的高层结构事实，比如语言、源码目录、测试目录、入口候选
- `file-index.json` — 记录文件级结构信息，比如 imports、exports、functions、classes 和轻量 symbol 提示

这份索引会在进入项目时初始化，在 `edit`、`write`、`patch` 后做增量刷新。它的目标是轻量、可靠、低噪声，而不是生成一份很长的 AI 报告。

<details>
<summary>数据目录与配置路径</summary>

- 全局会话状态：`<base-config-dir>/sessions/`
- 项目工作区状态：`.codemini/`
- 轻量项目索引：`.codemini/`
- 仓库内置 skill：`skills/<name>/SKILL.md`
- 项目级 skill：`.codemini/skills/<name>/SKILL.md`
- 全局已安装 skill：`<base-config-dir>/skills/<name>/SKILL.md`

`base-config-dir` 的解析顺序：

| 平台 | 路径 |
|------|------|
| `CODEMINI_GLOBAL_DIR` 环境变量 | `$CODEMINI_GLOBAL_DIR`（最高优先级） |
| Windows | `%APPDATA%\codemini-global\` |
| macOS | `~/Library/Preferences/codemini-global` |
| Linux / XDG | `$XDG_CONFIG_HOME/codemini-global` |
| 受限环境回退 | `.codemini-global/` |

</details>

### 适合谁

如果你想要的是下面这种工具，CodeMini CLI 会很合适：

- 能同时和大模型、小模型稳定协作的 coding CLI
- 更克制、更可控的工具暴露方式
- 真正重视 Windows / PowerShell 体验的终端工作流
- 能把计划、待办、工具调用和执行状态展示清楚的 TUI
- 更偏结构化操作、而不是大量 shell 噪声的代码助手

### 文档入口

- 操作手册与工作流说明：[OPERATIONS.md](./OPERATIONS.md)
- 打包与部署文档：[deployment.md](./deployment.md)
- 更新日志：[Releases](https://github.com/havingautism/Codemini-CLI/releases)

### 开发

```bash
# 安装依赖
npm install

# 运行测试
npm test

# 本地启动
npm start
```

### 许可证

[MIT](LICENSE)
