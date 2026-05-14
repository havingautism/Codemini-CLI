<p align="center">
  <img src="./codemini-web/codemini_logo.png" alt="Codemini logo" width="132" height="132" />
</p>

<h1 align="center">Codemini CLI</h1>

<p align="center">
  A sharp, controllable coding agent for teams that want the power of modern AI coding without the chaos of an oversized tool surface.
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

Codemini is a local-first coding assistant with a CLI, a polished browser UI, compact context management, project indexing, skills, personalities, planning, memory, approvals, and Windows-first shell ergonomics.

It is built around a simple product bet: coding agents get better when their default surface is smaller, their context is cleaner, and their actions are easier to audit.

### Why It Feels Different

| What you get | Why it matters |
| --- | --- |
| **Small default tool surface** | Models spend less time choosing tools and more time doing the next useful thing. |
| **Model-agnostic gateway config** | Works with OpenAI-compatible gateways and internal model providers. |
| **Web UI included** | Sessions, projects, approvals, skills, souls, CodeWiki reports, and runtime status in one local browser app. |
| **Compact context pipeline** | Micro-compact clears stale tool output; macro compact creates continuation summaries before context gets noisy. |
| **Windows and PowerShell first** | Designed for real Windows developer machines, not just Unix demos. |
| **Skills and souls** | Reusable workflows and response personalities without changing core execution policy. |
| **Project index** | Keeps a lightweight `.codemini/` map so the agent can orient quickly. |
| **Built-in safety rails** | Approvals, command policy, safe mode, todo tracking, and reviewable plans. |

### Quick Start

Requires **Node.js 22 or newer**.

```bash
npm install -g codemini-cli
codemini config set gateway.base_url http://your-gateway/v1
codemini config set gateway.api_key your_token
codemini config set model.name your-model
codemini
```

Open the Web UI:

```bash
codemini --web
```

On a new machine, the Web UI opens first and lets you configure the gateway from Settings, so a missing or wrong default endpoint does not block startup.

### Web UI

The Web UI is bundled with the npm package and runs locally.

```bash
codemini --web
codemini --web --port 3210 --project /path/to/project
codemini --web --session <session-id> --model <model-name> --no-open
```

Highlights:

| Area | What it does |
| --- | --- |
| Chat runtime | Uses the same sessions and config as the CLI. |
| Project switcher | Move between repositories and general chat without restarting. |
| Approvals | Review tool calls and plans in focused dialogs/cards. |
| Skills | Create, inspect, install, enable, and disable reusable workflows. |
| Souls | Switch response tone without changing execution logic. |
| CodeWiki | Generate project-requirements reports and ask read-only questions over them. |
| Runtime status | See active mode, git branch, version state, live progress, and context usage. |

Local Web UI development:

```bash
cd codemini-web
bun install
bun run dev
```

Single built server:

```bash
cd codemini-web
npm run build
npm run start -- --port 3210
```

### Command Surface

| Command | Description |
| --- | --- |
| `codemini [prompt]` | Start an interactive coding session. |
| `codemini chat [prompt]` | Chat mode for single-turn or multi-turn use. |
| `codemini run <task>` | Run a coding task non-interactively. |
| `codemini run --harness <role> <task>` | Run with a specific sub-agent role such as `coder`, `planner`, or `reviewer`. |
| `codemini run --pipeline <task>` | Run planning, implementation, and review as a pipeline. |
| `codemini --web` | Launch the local Web UI. |
| `codemini config set|get|list <key> [value]` | Manage gateway, model, shell, UI, context, memory, and soul settings. |
| `codemini doctor` | Run environment diagnostics. |
| `codemini skill list|install|enable|disable|inspect|reindex` | Manage builtin, project, and global skills. |

### Context Compacting

Codemini keeps long sessions usable with a two-phase compact pipeline:

1. **Micro compact** replaces old tool result bodies with a lightweight marker while preserving message order.
2. **Macro compact** summarizes older context and keeps a legal recent message window for model APIs.

The compact view is stored with the session, so follow-up prompts continue from the compressed context while the full transcript remains available in history.

### Skills

Skills are reusable workflow instructions that can be triggered explicitly or injected automatically when relevant.

Bundled skills:

| Skill | Use case |
| --- | --- |
| `superpowers-lite` | Default coding workflow: inspect, plan only when useful, edit narrowly, verify. |
| `grill-me` | Pressure-test plans, PRs, launches, or ideas. |
| `brainstorm` | Explore several reasonable approaches before coding. |
| `writing-plans` | Produce implementation plans with exact files and checks. |

```bash
codemini skill list
codemini skill install <path>
codemini skill install --scope=global <path>
codemini skill inspect <name>
```

Routing metadata is kept in a top-level catalog, so third-party `SKILL.md` files can stay unchanged:

```text
skills/codemini.skills.json
.codemini/skills/codemini.skills.json
```

The catalog stores lightweight routing fields such as `description`, `mode`, `triggers`, `enabled`, and `priority`. Codemini reads that metadata at startup and loads the full `SKILL.md` body only when a skill is selected or invoked. If the catalog is missing or incomplete, Codemini falls back to the skill directory and `SKILL.md` frontmatter.

### Souls

Souls change tone and expression style without changing tool policy or execution behavior.

Built-in presets:

```text
default, professional, ceo, playful, anime, caveman, pirate
```

```bash
codemini config set soul.preset professional
```

Safe mode normally restricts file tools and absolute shell paths to the current workspace. Add explicit extra roots when a project needs shared assets or sibling repositories:

```bash
codemini config set policy.allowed_paths '["D:\\shared-assets","E:\\sibling-repo"]'
```

### Memory And Dream Loop

Codemini has native memory tools and slash commands:

| Command | Purpose |
| --- | --- |
| `/capture <summary>` | Capture a high-signal observation into inbox. |
| `/inbox` | Review pending memory evidence. |
| `/dream [--dry-run]` | Consolidate inbox entries into durable user/global/project memory. |
| `/reflect` | Turn a successful workflow into a reviewed `SKILL.md` draft. |

Inbox is intentionally temporary and noisy. Dream consolidation decides what deserves promotion into longer-term memory.

### Project Index

Codemini maintains a lightweight project map under `.codemini/`:

| File | Purpose |
| --- | --- |
| `.codemini/project-map.json` | Languages, roots, tests, entry candidates, and repo-level facts. |
| `.codemini/file-index.json` | Imports, exports, functions, classes, and symbol hints. |

The index is initialized when entering a project and refreshed after edits/writes/patches.

### Optional Accelerators

FFF search acceleration:

```bash
codemini doctor
```

If `fff-mcp` is present in `PATH`, Codemini can use it for faster `grep`, `glob`, and selected `list` paths. If it is missing, built-in search is used.

Playwright rendering for JavaScript-heavy pages:

```bash
npm install -g playwright
playwright install chromium
```

### Data Paths

| Scope | Path |
| --- | --- |
| Global sessions | `<base-config-dir>/sessions/` |
| Project state | `.codemini/` |
| Project skills | `.codemini/skills/<name>/SKILL.md` |
| Global skills | `<base-config-dir>/skills/<name>/SKILL.md` |
| Windows config | `%APPDATA%\codemini-global\` |
| macOS config | `~/Library/Preferences/codemini-global` |
| Linux/XDG config | `$XDG_CONFIG_HOME/codemini-global` |

### Development

```bash
npm install
npm test
npm start
```

Build the bundled Web UI:

```bash
npm run build:web
```

### Documentation

- [OPERATIONS.md](./OPERATIONS.md) - day-to-day operator guide
- [deployment.md](./deployment.md) - packaging, installation, and deployment
- [Releases](https://github.com/havingautism/Codemini-CLI/releases) - changelog

### License

[MIT](./LICENSE)

---

<a id="简体中文"></a>

## 简体中文

Codemini 是一个本地优先的 coding agent：既有 CLI，也有精致的本地 Web UI；内置上下文压缩、项目索引、Skills、Souls、计划审批、记忆演化和 Windows / PowerShell 友好的执行体验。

它的核心判断很简单：coding agent 不应该默认暴露一堆工具、塞满上下文、让用户看不清它做了什么。Codemini 选择更小的默认工具面、更干净的上下文、更可审计的执行链路。

### 为什么看起来更像一个产品

| 你得到什么 | 为什么重要 |
| --- | --- |
| **精简默认工具面** | 模型少犹豫，少乱走，优先做下一件有用的事。 |
| **模型网关可配置** | 支持 OpenAI 兼容接口，也适合内部模型网关。 |
| **内置 Web UI** | 会话、项目、审批、技能、人格、CodeWiki、运行状态集中管理。 |
| **上下文压缩链路** | micro compact 清理旧工具输出，macro compact 生成可继续工作的摘要。 |
| **Windows / PowerShell 一等支持** | 面向真实 Windows 开发机，而不是只适配 Unix demo。 |
| **Skills 和 Souls** | 把稳定工作流沉淀成技能，把回复风格和执行逻辑分开。 |
| **轻量项目索引** | 在 `.codemini/` 里维护事实索引，让模型更快理解仓库。 |
| **安全和审计** | 审批、命令策略、safe mode、todo、计划卡片都内置。 |

### 快速开始

需要 **Node.js 22 或更高版本**。

```bash
npm install -g codemini-cli
codemini config set gateway.base_url http://your-gateway/v1
codemini config set gateway.api_key your_token
codemini config set model.name your-model
codemini
```

启动 Web UI：

```bash
codemini --web
```

新电脑上即使默认接口还没配置好，Web UI 也会先打开，然后在设置里配置 Base URL、API Key 和模型，不会因为默认接口 404 卡住启动。

### Web UI

Web UI 随 npm 包一起发布，本地运行：

```bash
codemini --web
codemini --web --port 3210 --project /path/to/project
codemini --web --session <session-id> --model <model-name> --no-open
```

能力概览：

| 区域 | 作用 |
| --- | --- |
| 对话运行时 | 复用 CLI 的会话和配置。 |
| 项目切换 | 不重启进程也能切换仓库和普通会话。 |
| 审批 | 用弹窗/卡片审阅工具调用和计划。 |
| Skills | 创建、查看、安装、启用、禁用可复用工作流。 |
| Souls | 切换表达风格，不影响执行策略。 |
| CodeWiki | 生成项目需求报告，并基于报告做只读问答。 |
| 运行状态 | 展示执行模式、git 分支、版本状态、实时进度和上下文占用。 |

本地开发：

```bash
cd codemini-web
bun install
bun run dev
```

构建后单进程运行：

```bash
cd codemini-web
npm run build
npm run start -- --port 3210
```

### 命令概览

| 命令 | 说明 |
| --- | --- |
| `codemini [prompt]` | 启动交互式编码会话。 |
| `codemini chat [prompt]` | 单轮或多轮对话模式。 |
| `codemini run <task>` | 非交互式执行编码任务。 |
| `codemini run --harness <role> <task>` | 用指定 sub-agent 角色执行任务。 |
| `codemini run --pipeline <task>` | 计划、实现、审查流水线。 |
| `codemini --web` | 打开本地 Web UI。 |
| `codemini config set|get|list <key> [value]` | 管理网关、模型、shell、UI、上下文、记忆、人格配置。 |
| `codemini doctor` | 环境诊断。 |
| `codemini skill list|install|enable|disable|inspect|reindex` | 管理内置、项目级、全局 Skills。 |

### 上下文压缩

Codemini 用两阶段 compact 保持长会话可继续：

1. **Micro compact**：把旧 tool result 正文替换成轻量标记，保留消息顺序。
2. **Macro compact**：把旧上下文总结成 continuation summary，并保留合法的最近消息窗口。

compact view 会写入 session，后续提问使用压缩视图继续；完整历史仍留在 session 里。

### Skills

Skill 是可复用工作流，可以显式触发，也可以在适合时自动注入。

内置 Skills：

| Skill | 适用场景 |
| --- | --- |
| `superpowers-lite` | 默认编码流程：先理解、必要时计划、小范围编辑、验证后报告。 |
| `grill-me` | 对方案、PR、发布、想法做压力测试。 |
| `brainstorm` | 多种方案都合理时，先比较选项再动手。 |
| `writing-plans` | 生成带文件路径和验证步骤的实施计划。 |

```bash
codemini skill list
codemini skill install <path>
codemini skill install --scope=global <path>
codemini skill inspect <name>
```

路由元数据集中放在顶层 catalog，第三方 `SKILL.md` 可以保持原样：

```text
skills/codemini.skills.json
.codemini/skills/codemini.skills.json
```

catalog 维护 `description`、`mode`、`triggers`、`enabled`、`priority` 等轻量路由字段。Codemini 启动时只读取这些元数据，只有 skill 被命中或显式调用时才读取完整 `SKILL.md`。如果 catalog 缺失或不完整，会回退到 skill 目录和 `SKILL.md` frontmatter。

### Souls

Soul 只改变语气和表达风格，不改变工具策略或执行逻辑。

内置预设：

```text
default, professional, ceo, playful, anime, caveman, pirate
```

```bash
codemini config set soul.preset professional
```

Safe mode 默认把文件工具和 shell 绝对路径限制在当前工作区。需要访问共享素材或兄弟仓库时，可以显式加入额外根目录：

```bash
codemini config set policy.allowed_paths '["D:\\shared-assets","E:\\sibling-repo"]'
```

### 记忆与 Dream Loop

Codemini 内置记忆工具和斜杠命令：

| 命令 | 作用 |
| --- | --- |
| `/capture <summary>` | 捕获高信号观察到 inbox。 |
| `/inbox` | 查看待整理记忆证据。 |
| `/dream [--dry-run]` | 把 inbox 整理进长期/项目记忆。 |
| `/reflect` | 把成功工作流沉淀成可审阅的 `SKILL.md` 草稿。 |

Inbox 是临时的、可能带噪的证据层；Dream consolidation 决定哪些内容值得晋升为长期记忆。

### 项目索引

Codemini 会维护 `.codemini/` 轻量索引：

| 文件 | 作用 |
| --- | --- |
| `.codemini/project-map.json` | 语言、源码目录、测试目录、入口候选和仓库事实。 |
| `.codemini/file-index.json` | imports、exports、functions、classes 和 symbol 提示。 |

进入项目时初始化，编辑/写入/patch 后增量刷新。

### 可选增强

FFF 搜索加速：

```bash
codemini doctor
```

如果 `fff-mcp` 在 `PATH` 中，Codemini 会自动用于更快的 `grep`、`glob` 和部分 `list`。缺失时自动回退内置搜索。

Playwright 网页渲染：

```bash
npm install -g playwright
playwright install chromium
```

### 数据路径

| 范围 | 路径 |
| --- | --- |
| 全局会话 | `<base-config-dir>/sessions/` |
| 项目状态 | `.codemini/` |
| 项目 Skills | `.codemini/skills/<name>/SKILL.md` |
| 全局 Skills | `<base-config-dir>/skills/<name>/SKILL.md` |
| Windows 配置 | `%APPDATA%\codemini-global\` |
| macOS 配置 | `~/Library/Preferences/codemini-global` |
| Linux/XDG 配置 | `$XDG_CONFIG_HOME/codemini-global` |

### 开发

```bash
npm install
npm test
npm start
```

构建 Web UI：

```bash
npm run build:web
```

### 文档

- [OPERATIONS.md](./OPERATIONS.md) - 日常操作手册
- [deployment.md](./deployment.md) - 打包、安装、部署
- [Releases](https://github.com/havingautism/Codemini-CLI/releases) - 更新记录

### 许可证

[MIT](./LICENSE)
