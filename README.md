<p align="center">
  <img src="./codemini-web/codemini_logo.png" alt="Codemini logo" width="132" height="132" />
</p>

<h1 align="center">Codemini CLI</h1>

<p align="center">
  <b>An extremely restrained coding + tasks CLI.</b><br />
  Every platform. Every terminal. Minimal by design.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/codemini-cli"><img alt="npm version" height="24" src="https://img.shields.io/npm/v/codemini-cli?style=flat&logo=npm&logoColor=white&label=npm&labelColor=0f172a&color=cb3837"></a>
  <a href="https://nodejs.org"><img alt="node version" height="24" src="https://img.shields.io/badge/node-%3E%3D22-339933?style=flat&logo=nodedotjs&logoColor=white&labelColor=0f172a"></a>
  <a href="./LICENSE"><img alt="license" height="24" src="https://img.shields.io/badge/license-MIT-2563eb?style=flat&labelColor=0f172a"></a>
  <a href="#web-ui"><img alt="web ui included" height="24" src="https://img.shields.io/badge/Web%20UI-included-7c3aed?style=flat&logo=googlechrome&logoColor=white&labelColor=0f172a"></a>
  <a href="#quick-start"><img alt="quick start" height="24" src="https://img.shields.io/badge/quick%20start-3%20commands-f97316?style=flat&logo=rocket&logoColor=white&labelColor=0f172a"></a>
</p>

<p align="center">
  <a href="#english">English</a>
  ·
  <a href="#简体中文">简体中文</a>
  ·
  <a href="#web-ui">Web UI</a>
  ·
  <a href="./OPERATIONS.md">Operator Guide</a>
  ·
  <a href="./deployment.md">Deployment</a>
</p>

---

<a id="english"></a>

## English

### What is Codemini?

Codemini is a **coding + tasks CLI** built for a simple premise: agentic help should work everywhere, scale from small models to frontier ones, and never waste your context budget.

It is equally at home refactoring a TypeScript codebase, automating a Git workflow, running a multi-step DevOps pipeline, or bulk-processing data files. **It is not limited to writing code** — it is a general-purpose task agent that happens to be very good at code.

It runs on Windows, macOS, or Linux — in any terminal (PowerShell, bash, zsh, and others). It works with any OpenAI-compatible or Anthropic API, so you are never locked into a single provider. And it gives you **two surfaces** — a rich terminal TUI and a browser-based Web UI — sharing the same sessions and engine.

Codemini can use **two models in one session**: a lightweight model for routing and simple tasks, and a larger model for complex reasoning. Configure both, and the system dispatches work to the right one.

Other built-in capabilities include project indexing, persistent memory with self-evolution via the Reflect action, skill-based workflows, coding mode for implementation-heavy work, approvals, and soul presets that change its tone without changing its behavior.

No SaaS. No telemetry. No mandatory registration.

### Why "Restrained"?

Many coding agents pursue an ever-expanding surface — more tools, more context, more automation. Codemini takes the opposite approach.

- **Small dependency footprint.** A focused set of npm packages. No Electron, no Docker, no Python runtime.
- **Managed context budgets.** Micro-compaction, tool-result spill-to-disk, prompt preflight triggers — designed to stay within your model's window.
- **Dual-model dispatch.** Configure a lightweight model (for routing and simple tasks) alongside a frontier model (for complex reasoning). Work reaches the right model automatically.
- **Proportional approvals.** Commands are classified by intent. Read-only operations pass through; destructive actions prompt for confirmation. You control the threshold.
- **Lazy-loaded skills.** A catalog of 1,000 skills costs the same as 1. Only the invoked skill contributes to the prompt.
- **Curated memory with self-evolution.** Inbox is temporary by design. The dream loop curates it, and the Reflect action converts successful patterns into reusable skills.

It is not about delivering less capability. It is about eliminating what you should not have to carry.

#### By the Numbers: What "Restrained" Looks Like

A typical first-turn system prompt in a real project — with AGENTS.md, an auto skill, memory snapshot, and project context — costs approximately **5,300 tokens**. The breakdown:

```
  base system prompt          2,703 tokens  ████████████████░░░░░░░░░  51%
  AGENTS.md project rules       535 tokens  ███░░░░░░░░░░░░░░░░░░░░░  10%
  auto skill (superpowers)    1,371 tokens  ████████░░░░░░░░░░░░░░░░  26%
  memory snapshot               144 tokens  █░░░░░░░░░░░░░░░░░░░░░░░   3%
  project index snippet         447 tokens  ██░░░░░░░░░░░░░░░░░░░░░░   8%
  reply language wrapper         27 tokens  ░░░░░░░░░░░░░░░░░░░░░░░░   1%
  ─────────────────────────────────────────────────────────────────
  total first turn            ~5,300 tokens
```

By contrast, many alternatives ship **15K–25K tokens** of system prompt before a user's first message. Every installed skill, saved memory, and rule file is poured in unconditionally.

Codemini's restraint is architectural:

- **Skills lazy-load.** Ten skills installed = same system prompt cost as zero. Only the selected skill's body is loaded.
- **Memory is curated.** Inbox is temporary noise; only promoted memories enter the prompt. You control the volume.
- **Project index is compact.** Symbol maps replace raw file trees. An entire repository fits in a few hundred tokens.
- **No hidden payloads.** No telemetry scripts, no usage trackers, no injected context you did not request.

The principle is straightforward: **less prompt tax means more budget for actual work.**

### Quick Start

```bash
# Install globally
npm install -g codemini-cli

# Configure your gateway
codemini config set gateway.base_url http://127.0.0.1:8000/v1
codemini config set gateway.api_key your_api_key
codemini config set model.name your_model_name

# Start a session
codemini
```

Three commands, and you are in an interactive session.

### Web Search Provider

`web_search` defaults to `bing_rss`, which does not require an API key. To use an API-backed search provider:

```bash
codemini config set web.search_provider tavily
codemini config set web.tavily_api_key your_tavily_api_key

# or
codemini config set web.search_provider exa
codemini config set web.exa_api_key your_exa_api_key
```

You can also use `TAVILY_API_KEY` or `EXA_API_KEY` environment variables instead of saving the key in config.

### Beyond Code: Automated Tasks

Codemini's `codemini run` command turns any natural-language task into an automated workflow — no coding required.

```bash
# Interactive session (chat)
codemini "Summarize the recent Git history and write a CHANGELOG.md"

# One-off task
codemini run "Find all .env files in this repo and check for hardcoded secrets"

# Multi-role harness — planner + coder + reviewer in sequence
codemini run --harness coder "Refactor the auth module to extract middleware"

# Pipeline — sequential steps with artifact passing
codemini run --pipeline "Bump version, update CHANGELOG, and create a GitHub release draft"
```

Common non-coding task examples:

| Task | Command |
| --- | --- |
| **System diagnostics** | `codemini run "Check disk usage, top 5 memory processes, and recent error logs"` |
| **Git batch operations** | `codemini run "Squash the last 3 commits with message 'fix: pagination edge cases'"` |
| **Data migration** | `codemini run "Read users.csv, normalize emails, deduplicate by ID, write to users.json"` |
| **Release prep** | `codemini run --pipeline "Bump patch version, update CHANGELOG, git tag, build"` |
| **Dependency audit** | `codemini run "List all outdated npm packages and summarize breaking changes"` |
| **Project cleanup** | `codemini run "Find orphaned test fixtures and temporary debug logs"` |

The `--harness` flag assigns a **role** (`planner`, `advisor`, `coder`, `reviewer`, `tester`) that constrains tool access. The `--pipeline` flag runs a multi-step plan where each step's output feeds the next. Both modes turn Codemini into a headless task agent — like Claude Code, but running entirely on your machine, with your model, under your approval policy.

| What | Why it matters |
| --- | --- |
| **🧠 Persistent Memory** | Capture action → inbox → dream consolidation → user, global, and project memory tiers. Your agent learns from your project. |
| **📂 Project Index** | Automatic `.codemini/` index with languages, symbols, imports, and exports. Refreshed incrementally after every edit. |
| **🛠 Skills System** | Decoupled routing metadata with lazy-loaded `SKILL.md` bodies. Bring your own workflow or choose from built-in presets. |
| **🔄 Self-Evolution** | The Reflect action converts successful workflows into reusable, reviewable `SKILL.md` files. Your toolset grows with your project. |
| **⚡ Dual-Model Dispatch** | Configure a fast, lightweight model alongside a capable frontier model. The system routes each task to the appropriate one. |
| **🖥 Terminal TUI** | Rich, interactive terminal UI with spinner animations, syntax-highlighted code blocks, live command output, and real-time status. |
| **🕸 Web UI** | Full browser interface — same engine, shared sessions. Switch between terminal and browser freely. |
| **🎭 Souls** | Tone presets (`professional`, `playful`, `anime`, `caveman`…) that change expression without affecting execution policy. |
| **📋 Planning Mode** | Multi-step plans with file paths, verification steps, and explicit approval before execution. |
| **🔒 Approvals** | Commands classified by risk level. Read-only passes; destructive operations pause for confirmation. Configurable thresholds. |
| **💾 Session Checkpoints** | Save, branch, or replay session state. Context is preserved across crashes and model errors. |
| **🌍 Cross-Platform** | PowerShell on Windows, bash/zsh on macOS and Linux — same tool, same configuration format, same behavior. |

### Skills

Skills are reusable, reviewable workflow recipes. Built-in:

| Skill | When to use |
| --- | --- |
| `using-superpowers` | Default skill router: decide which development workflow applies. |
| `brainstorming` | Compare options when multiple approaches are reasonable. |
| `systematic-debugging` | Investigate bugs, failing tests, and unexpected behavior. |
| `test-driven-development` | Implement behavior changes with focused tests. |
| `verification-before-completion` | Verify work before claiming it is done. |

```bash
codemini skill list
codemini skill install <path>
codemini skill inspect <name>
codemini skill enable <name>
codemini skill disable <name>
codemini skill reindex
```

Skills use a flat catalog (`codemini.skills.json`) with lightweight routing metadata — `description`, `mode`, `triggers`, `enabled`, `priority`. Codemini reads only this metadata at startup; the full `SKILL.md` is loaded only when a skill is selected or invoked. If the catalog is missing, the system falls back to `SKILL.md` frontmatter.

Select enabled skills from the action palette inside a session, or pass an explicit skill prompt from your shell:

```bash
# Inside an interactive session, press Ctrl+K and choose a skill.

# One-off invocation from your shell
codemini 'skill:[brainstorming] compare SQLite, Postgres, and DuckDB for local analytics'
codemini '/project-requirements generate a CodeWiki report for this repository'
```

### Terminal TUI & Web UI

Codemini gives you **two surfaces** powered by the same engine.

**Terminal TUI** — rich interactive interface with spinner animations for long-running tasks, syntax-highlighted code blocks, live command output streaming, and a command palette with autocomplete. Runs in any terminal emulator; no separate process needed.

**Web UI** — full browser interface sharing the same session state:

```bash
codemini --web
```

Sessions are shared between terminal and browser — switch freely. From an active CLI session, type `web` to launch the browser UI.

Additional Web UI options (port, project directory, session, model) are available via flags like `--port`, `--project`, `--session`, `--model`, `--no-open`.

### Concurrent Web sessions

The Web UI can run up to three sessions at once. Additional sessions queue automatically, and switching conversations does not stop background work. Approval and user-input requests pause only their owning session.

Sessions may share a project directory. Codemini detects stale writes made through its managed file tools, but arbitrary shell commands can still conflict; the session list shows a warning while same-project tasks overlap. Interrupted work is not replayed after a server restart.

**Souls** — change the agent's tone without changing behavior. Built-in presets: `default`, `professional`, `ceo`, `playful`, `anime`, `caveman`, `pirate`. Configure with `codemini config set soul.preset professional`.

### Memory, Self-Evolution & Dream Loop

Codemini's memory system is designed to **learn from your work**, not just store facts.

| Action | Purpose |
| --- | --- |
| Capture | Record a signal into the inbox. |
| Inbox | Review pending memory evidence. |
| Dream | Consolidate inbox entries into durable user/global/project memory. |
| Reflect | Convert a successful workflow pattern into a reviewable `SKILL.md` — your toolset evolves as you work. |

The inbox is intentionally noisy. The dream loop determines what deserves promotion into longer-term storage. And the Reflect action closes the loop: a pattern you've repeated successfully becomes a reusable skill, reviewed and versioned alongside your project.

Typical reflect loop:

```bash
# 1. Finish a workflow that worked well, then ask Codemini to extract the pattern.
Choose Reflect and describe the provider tool-call recovery workflow.

# 2. Review the generated draft in the TUI/Web UI.
Choose Write in the review controls.

# 3. Codemini writes .codemini/skills/provider-tool-call-recovery/SKILL.md
#    and makes it available in the action palette.

# 4. The same skill can also be launched directly from the shell.
codemini '/provider-tool-call-recovery audit provider message conversion'
```

Use `--scope=global` when the workflow should follow you across repositories:

```bash
codemini '/reflect --scope=global turn the release checklist I just used into a reusable skill'
codemini '/release-checklist prepare a patch release'
```

### Project Index & Code Intelligence

Codemini builds a lightweight but precise code index for every project you work in. It uses **Tree-sitter AST parsing** to extract symbols — not naive regex or line counting.

| File | Content |
| --- | --- |
| `.codemini/project-map.json` | Languages, source roots, test directories, entry candidates, repository facts. |
| `.codemini/file-index.json` | Per-file imports, exports, function and class declarations, interfaces, type aliases — extracted via language-aware AST queries. |

The index powers every code-aware tool in the system:

- **`grep` and `glob`** use the file map to skip irrelevant directories (node_modules, build artifacts, .git) before touching the filesystem.
- **`ast_query` / `read_ast_node`** resolve symbol targets to precise line and column ranges, enabling surgical edits without manual offset math.
- **`read` with AST context** can return enclosing function bodies or class definitions around a cursor position.

Index freshness is maintained incrementally: after every `edit`, `write`, or `patch` call, only the affected file is re-parsed and its index entry replaced. No full rebuild on every change.

Language support covers JavaScript, TypeScript, TSX, Python, Go, C, C++, Rust, Java, C#, PHP, Ruby, and Bash — each with a dedicated Tree-sitter grammar.

### Data Paths

| Scope | Path |
| --- | --- |
| Global sessions | `<base-config-dir>/sessions/` |
| Project state | `.codemini/` |
| Project skills | `.codemini/skills/<name>/SKILL.md` |
| Global skills | `<base-config-dir>/skills/<name>/SKILL.md` |
| Windows | `%APPDATA%\codemini-global\` |
| macOS | `~/Library/Preferences/codemini-global` |
| Linux / XDG | `$XDG_CONFIG_HOME/codemini-global` |

The base config directory can be overridden via the `CODEMINI_GLOBAL_DIR` environment variable.

### Optional Accelerators

**FFF search acceleration:** `codemini doctor` checks for `fff-mcp` in the system PATH and uses it for faster `grep`, `glob`, and selected `list` operations. Falls back to built-in search if unavailable.

**Playwright rendering** for JavaScript-heavy pages:

```bash
npm install -g playwright
playwright install chromium
```

### Development

```bash
npm install
npm test
npm start
```

Build the Web UI bundle for production:

```bash
npm run build:web
```

### Documentation

- [OPERATIONS.md](./OPERATIONS.md) — daily operations manual
- [deployment.md](./deployment.md) — packaging, installation, deployment
- [Releases](https://github.com/havingautism/Codemini-CLI/releases)

### License

[MIT](./LICENSE)

---

<a id="简体中文"></a>

## 简体中文

### Codemini 是什么？

**一款刻意保持克制的 coding + tasks CLI。** 不仅能写代码——Git 工作流自动化、DevOps 流水线、数据批量处理、系统诊断，它都能干。

兼容 Windows PowerShell、macOS zsh、Linux bash 等各种终端环境。兼容任何 OpenAI 兼容或 Anthropic 的 API，不绑定特定模型或提供商。提供**双界面**——基于 Ink + React 构建的终端 TUI 和浏览器 Web UI——共享同一引擎和会话。

支持**大小模型协同工作**：配置一个轻量模型处理路由和简单任务，一个大模型负责复杂推理，系统自动调度。

其他内置能力包括项目索引、持久记忆与 Reflect 操作驱动的自我进化、技能工作流、计划模式、审批机制，以及仅改变语气不改变行为的人格预设（Souls）。

无需 SaaS、无需遥测、无需注册。

### 「克制」体现在哪里？

当前多数 AI 编码工具的策略是做加法——不断堆叠工具、上下文、自动化能力。Codemini 选择了相反的方向。

- **依赖极简。** 仅依赖少量精选的 npm 包。没有 Electron、Docker 或 Python 运行时。
- **上下文预算可控。** 微压缩、工具结果溢出到磁盘、提示预检触发——为控制模型窗口使用而设计。
- **大小模型协同。** 配置一个轻量模型处理路由和简单任务，一个大模型负责复杂推理，系统自动分派。
- **审批有度。** 命令按意图分级：只读操作直接放行，破坏性操作暂停确认。阈值由你设定。
- **技能懒加载。** 注册 1,000 个技能与注册 1 个的开销相同。只有被实际调用的技能才会进入提示上下文。
- **记忆择优而存，自我进化。** Inbox 本质上是临时草稿箱，Dream 循环决定晋升内容，Reflect 操作把成功工作流沉淀为可复用的 skill。

并非功能更少，而是不背负不必要的负担。

#### 数据视角：「克制」的实际效果

一个真实项目的首轮 system prompt——包含 AGENTS.md、auto skill、记忆快照和项目上下文——大约消耗 **5,300 tokens**。具体构成如下：

```
  基础 system prompt           2,703 tokens  ████████████████░░░░░░░░░  51%
  AGENTS.md 项目规则             535 tokens  ███░░░░░░░░░░░░░░░░░░░░░  10%
  auto skill（superpowers）    1,371 tokens  ████████░░░░░░░░░░░░░░░░  26%
  记忆快照                       144 tokens  █░░░░░░░░░░░░░░░░░░░░░░░   3%
  项目索引片段                   447 tokens  ██░░░░░░░░░░░░░░░░░░░░░░   8%
  回复语言包装                    27 tokens  ░░░░░░░░░░░░░░░░░░░░░░░░   1%
  ─────────────────────────────────────────────────────────────────
  首轮总计                     ~5,300 tokens
```

相比之下，许多同类工具在用户发出第一条消息之前，**system prompt 已占用 15K–25K tokens**。每安装一个 skill、每保存一条记忆、每编写一个规则文件，都会无条件注入。

Codemini 的克制源自架构设计：

- **Skill 懒加载。** 安装 10 个 skill 与安装 0 个，system prompt 开销相同。只有被命中的 skill 才会加载完整内容。
- **记忆有筛选。** Inbox 是临时噪声层，只有经过晋升的记忆才会进入提示上下文。你控制水位。
- **项目索引紧凑。** 符号映射替代原始文件树。整个仓库仅需数百 token。
- **无隐藏负担。** 没有遥测脚本、用量追踪，或未经你要求注入的上下文。

核心逻辑很简单：**prompt 税越少，留给实际工作的预算就越多。**

### 快速开始

```bash
# 全局安装
npm install -g codemini-cli

# 配置网关
codemini config set gateway.base_url http://127.0.0.1:8000/v1
codemini config set gateway.api_key 你的 API Key
codemini config set model.name 你的模型名称

# 启动会话
codemini
```

三步完成配置，进入交互式会话。

### 联网搜索提供方

`web_search` 默认使用无需 API Key 的 `bing_rss`。如需切换到 API 搜索服务：

```bash
codemini config set web.search_provider tavily
codemini config set web.tavily_api_key 你的_tavily_api_key

# 或
codemini config set web.search_provider exa
codemini config set web.exa_api_key 你的_exa_api_key
```

也可以使用 `TAVILY_API_KEY` 或 `EXA_API_KEY` 环境变量，避免把 key 写入配置文件。

### 不止写代码：自动化任务

`codemini run` 可以把任何自然语言任务变成自动化工作流——不需要写脚本。

```bash
# 交互式会话
codemini "查看最近的 Git 提交历史，生成一份 CHANGELOG.md"

# 一次性任务
codemini run "扫描项目中所有 .env 文件，检查是否有硬编码密钥"

# 多角色组合 — planner + coder + reviewer 接力
codemini run --harness coder "重构 auth 模块，抽离中间件"

# 流水线 — 多步骤任务，步骤间传递产物
codemini run --pipeline "升级版本号、更新 CHANGELOG、创建 GitHub release 草稿"
```

非编码任务举例如下：

| 任务 | 命令 |
| --- | --- |
| **系统诊断** | `codemini run "检查磁盘使用率、Top 5 内存进程、最近错误日志"` |
| **Git 批量操作** | `codemini run "把最近 3 个 commit 压缩成一个，提交信息为 fix: pagination edge cases"` |
| **数据迁移** | `codemini run "读取 users.csv，标准化邮箱字段，按 ID 去重，写入 users.json"` |
| **版本发布** | `codemini run --pipeline "升级 patch 版本、更新 CHANGELOG、git tag、构建"` |
| **依赖审计** | `codemini run "列出所有过时的 npm 包，概述 breaking changes"` |
| **项目清理** | `codemini run "查找孤立的测试 fixture 文件和临时调试日志"` |

`--harness` 参数指定一个**角色**（`planner`、`advisor`、`coder`、`reviewer`、`tester`），每个角色有独立的工具访问权限。`--pipeline` 执行多步骤计划，每步输出自动传入下一步。两种模式让 Codemini 变成无头任务 agent——类似 Claude Code，但完全运行在你的机器上、使用你的模型、遵循你的审批策略。

### 功能速览

| 功能 | 说明 |
| --- | --- |
| **🧠 持久记忆** | Capture 操作 → inbox → dream 整理 → 用户/全局/项目三层记忆。让 agent 记住项目上下文。 |
| **📂 项目索引** | 自动维护 `.codemini/` 索引，记录语言、符号、导入导出关系。编辑后增量刷新。 |
| **🛠 技能系统** | 路由元数据与技能体分离。可自行编写 `SKILL.md`，也可使用内置工作流。 |
| **🔄 自我进化** | Reflect 操作把成功工作流转化为可复用的 `SKILL.md`。你的工具箱随项目成长。 |
| **⚡ 大小模型协同** | 配置轻量模型做路由与简单任务，大模型做复杂推理，系统自动分派。 |
| **🖥 终端 TUI** | 富交互终端界面——旋转动画、语法高亮代码块、实时命令输出流、自动补全命令面板。 |
| **🕸 Web UI** | 浏览器界面，同一引擎。终端与浏览器共享会话，可随时切换。 |
| **🎭 Souls 人格** | 预设语气（专业、活泼、动漫、原始人……），只改变表达方式，不改变执行策略。 |
| **📋 计划模式** | 多步骤实施计划，包含文件路径与验证步骤，执行前需确认。 |
| **🔒 命令审批** | 按风险分级：只读操作直接放行，破坏性操作暂停确认。阈值可配置。 |
| **💾 会话检查点** | 随时保存、回退、分支会话状态。崩溃或模型异常不丢失上下文。 |
| **🌍 全平台支持** | Windows PowerShell、macOS zsh、Linux bash——同一套配置，同一套行为。 |

### Skills

Skills 是可复用、可审阅的工作流配方。内置：

| Skill | 适用场景 |
| --- | --- |
| `using-superpowers` | 默认 skill 路由：判断当前任务应使用哪种开发流程。 |
| `brainstorming` | 多种方案难以抉择时，先比较选项再行动。 |
| `systematic-debugging` | 调查 bug、失败测试和异常行为。 |
| `test-driven-development` | 用聚焦测试驱动行为改动。 |
| `verification-before-completion` | 在声明完成前执行验证。 |

```bash
codemini skill list
codemini skill install <path>
codemini skill inspect <name>
codemini skill enable <name>
codemini skill disable <name>
codemini skill reindex
```

路由元数据集中在顶层 catalog（`codemini.skills.json`），仅存储 `description`、`mode`、`triggers`、`enabled`、`priority` 等轻量字段。启动时不读取完整 `SKILL.md`，仅在被命中或显式调用时才加载。catalog 缺失时回退到目录和 frontmatter。

任何启用的 skill 都可以在会话的操作面板中选择，也可以从 shell 通过显式 skill prompt 一次性启动：

```bash
# 在交互式会话中按 Ctrl+K，然后选择 skill。

# 从 shell 一次性调用
codemini 'skill:[brainstorming] 比较 SQLite、Postgres 和 DuckDB 做本地分析的取舍'
codemini '/project-requirements 为当前仓库生成一份 CodeWiki 报告'
```

### 终端 TUI 与 Web UI

Codemini 提供**双界面**，由同一引擎驱动。

**终端 TUI**——富交互界面，支持长时间任务的旋转动画、语法高亮的代码块、实时命令输出流、以及带自动补全的命令面板。在任何终端模拟器中运行，无需额外进程。

**Web UI**——完整的浏览器界面，与会话状态实时同步：

```bash
codemini --web
```

终端与浏览器共享会话，可自由切换。活动的 CLI 会话中输入 `web` 也可启动 Web UI。

更多 Web UI 选项（端口、项目目录、会话、模型等）通过 `--port`、`--project`、`--session`、`--model`、`--no-open` 等参数配置。

**Souls**——改变 agent 语气的预设（`default`、`professional`、`ceo`、`playful`、`anime`、`caveman`、`pirate`），不影响执行策略。配置：`codemini config set soul.preset professional`。

### 记忆、自我进化与 Dream Loop

Codemini 的记忆系统设计为**从你的工作中学习**，而不仅仅是存储事实。

| 操作 | 作用 |
| --- | --- |
| Capture | 将高信号观察记录到 inbox。 |
| Inbox | 查看待整理的记忆素材。 |
| Dream | 将 inbox 整理到用户/全局/项目三层长期记忆。 |
| Reflect | 将成功的工作流模式沉淀为可审阅的 `SKILL.md`——你的工具箱随工作进化。 |

Inbox 本质上是临时噪声层。Dream 循环决定哪些内容值得晋升。而 Reflect 操作完成了闭环：一个被你反复验证成功的工作模式，变成可复用的 skill，跟项目一起版本化管理。

典型的 reflect 闭环：

```bash
# 1. 完成一次效果很好的工作流后，让 Codemini 提炼可复用模式。
选择 Reflect，并描述刚才 provider tool-call 修复成功的链路。

# 2. 在 TUI/Web UI 中审阅生成的草稿。
在审阅控件中选择“写入”。

# 3. Codemini 写入 .codemini/skills/provider-tool-call-recovery/SKILL.md
#    并立即在操作面板中提供。

# 4. 也可以从 shell 直接一次性启动这个 skill。
codemini '/provider-tool-call-recovery 审计 provider message conversion'
```

如果这个工作流应该跨项目复用，可以写成全局 skill：

```bash
codemini '/reflect --scope=global 把刚才的发布检查流程沉淀成可复用 skill'
codemini '/release-checklist 准备一次 patch release'
```

### 项目索引与代码智能

Codemini 为每个项目构建轻量但精确的代码索引，核心使用 **Tree-sitter AST 解析**提取符号——而不是简单的正则或行数统计。

| 文件 | 内容 |
| --- | --- |
| `.codemini/project-map.json` | 语言、源码目录、测试目录、入口候选、仓库事实。 |
| `.codemini/file-index.json` | 每个文件的 imports、exports、函数和类声明、接口、类型别名——基于语言感知的 AST 查询提取。 |

索引为系统中的每个代码感知工具提供支持：

- **`grep` 和 `glob`** 利用文件映射跳过无关目录（node_modules、构建产物、.git），操作前无需触碰文件系统。
- **`ast_query` / `read_ast_node`** 将符号目标解析为精确的行列范围，实现手术刀式编辑，无需手动偏移计算。
- **`read` 带 AST 上下文** 可在光标位置附近返回包裹的函数体或类定义。

索引的 freshness 通过增量维护：每次 `edit`、`write` 或 `patch` 调用后，仅重新解析受影响的文件并替换其索引条目。无需每次变更都全量重建。

语言支持覆盖 JavaScript、TypeScript、TSX、Python、Go、C、C++、Rust、Java、C#、PHP、Ruby 和 Bash——每种语言使用独立的 Tree-sitter 语法。

### 数据路径

| 范围 | 路径 |
| --- | --- |
| 全局会话 | `<base-config-dir>/sessions/` |
| 项目状态 | `.codemini/` |
| 项目 Skills | `.codemini/skills/<name>/SKILL.md` |
| 全局 Skills | `<base-config-dir>/skills/<name>/SKILL.md` |
| Windows | `%APPDATA%\codemini-global\` |
| macOS | `~/Library/Preferences/codemini-global` |
| Linux / XDG | `$XDG_CONFIG_HOME/codemini-global` |

可通过 `CODEMINI_GLOBAL_DIR` 环境变量覆盖基础配置目录。

### 可选增强

**FFF 搜索加速：** `codemini doctor` 会检测 `fff-mcp` 是否在系统 PATH 中，若存在则自动用于加速 `grep`、`glob` 和部分 `list` 操作。未安装时自动回退内置搜索。

**Playwright 渲染** 用于 JavaScript 重载页面：

```bash
npm install -g playwright
playwright install chromium
```

### 开发

```bash
npm install
npm test
npm start
```

构建 Web UI 生产包：

```bash
npm run build:web
```

### 文档

- [OPERATIONS.md](./OPERATIONS.md) — 日常操作手册
- [deployment.md](./deployment.md) — 打包、安装、部署
- [Releases](https://github.com/havingautism/Codemini-CLI/releases)

### 许可证

[MIT](./LICENSE)
