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

**Contents** — [Why CodeMini CLI](#why-codemini-cli) · [Installation](#installation) · [Quick Start](#quick-start) · [Commands](#commands) · [Personalities (Souls)](#personalities-souls) · [Tool Model](#how-the-tool-model-works) · [Core Capabilities](#core-capabilities) · [Project Index](#project-index) · [Good Fit](#good-fit) · [Documentation](#documentation) · [Development](#development) · [License](#license)

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

### Commands

| Command | Description |
|---------|-------------|
| `codemini [prompt]` | Start an interactive coding session with an optional initial prompt |
| `codemini chat [prompt]` | Chat mode — single-turn or multi-turn conversation |
| `codemini run <task>` | Run a task non-interactively (e.g. `codemini run "fix the login bug"`) |
| `codemini config set\|get\|list <key> [value]` | Manage configuration (gateway, model, shell, UI, soul, etc.) |
| `codemini doctor` | Run environment diagnostics and validate configuration |
| `codemini skill list\|install\|enable\|disable\|inspect\|reindex` | Manage skills — list, install, toggle, or inspect bundled/third-party skills |

### Personalities (Souls)

CodeMini CLI supports swappable "soul" personalities that change tone and expression style without altering plan logic or code behavior.

Built-in souls: `default`, `professional`, `ceo`, `playful`, `anime`, `caveman`, `pirate`

```bash
codemini config set soul.preset playful
```

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
- Session-level todo checklists via `update_todos`, rendered natively in the TUI
- Unified shell execution model:
  - one-off commands via `run`
  - long-running commands via `run` with `run_in_background=true`
- Lightweight project index under `.codemini-project/`
- Tree-sitter based structured editing for function, class, and method-level changes
- Reply language control via `ui.reply_language`
- Safe mode enabled by default

### Project Index

CodeMini CLI maintains a lightweight project index inside `.codemini-project/`:

- `project-map.json` — high-level repository facts such as languages, source roots, test roots, and entry candidates
- `file-index.json` — per-file structure such as imports, exports, functions, classes, and lightweight symbol hints

The index is initialized when entering a project and refreshed incrementally after edits, writes, and patches. It is intended to be factual, compact, and inexpensive to keep current.

<details>
<summary>Data Layout &amp; Config Paths</summary>

- Global session state: `<base-config-dir>/sessions/`
- Project workspace state: `.codemini/`
- Lightweight project index: `.codemini-project/`
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

### 命令概览

| 命令 | 说明 |
|------|------|
| `codemini [prompt]` | 启动交互式编码会话，可附带初始提示 |
| `codemini chat [prompt]` | 对话模式——单轮或多轮 |
| `codemini run <task>` | 非交互式执行任务（如 `codemini run "修复登录 bug"`） |
| `codemini config set\|get\|list <key> [value]` | 管理配置（网关、模型、shell、UI、soul 等） |
| `codemini doctor` | 运行环境诊断并验证配置 |
| `codemini skill list\|install\|enable\|disable\|inspect\|reindex` | 管理 skill——列表、安装、启用/禁用、检查 |

### 个性人格（Souls）

CodeMini CLI 支持可切换的 "soul" 人格，仅改变语气和表达风格，不影响计划逻辑或代码行为。

内置人格：`default`、`professional`、`ceo`、`playful`、`anime`、`caveman`、`pirate`

```bash
codemini config set soul.preset playful
```

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
- 通过 `update_todos` 维护复杂单任务的会话级待办清单，并直接渲染在 TUI 中
- 统一的 shell 执行模型：
  - 一次性命令直接 `run`
  - 长运行命令通过 `run` + `run_in_background=true`
- 在 `.codemini-project/` 下维护轻量项目索引，帮助模型更快理解仓库
- 基于 Tree-sitter 的结构化编辑能力，适合函数级、类级、方法级改动
- 支持通过 `ui.reply_language` 控制回复语言
- safe mode 默认开启

### 项目索引

CodeMini CLI 会在 `.codemini-project/` 下维护一份轻量项目索引：

- `project-map.json` — 记录仓库的高层结构事实，比如语言、源码目录、测试目录、入口候选
- `file-index.json` — 记录文件级结构信息，比如 imports、exports、functions、classes 和轻量 symbol 提示

这份索引会在进入项目时初始化，在 `edit`、`write`、`patch` 后做增量刷新。它的目标是轻量、可靠、低噪声，而不是生成一份很长的 AI 报告。

<details>
<summary>数据目录与配置路径</summary>

- 全局会话状态：`<base-config-dir>/sessions/`
- 项目工作区状态：`.codemini/`
- 轻量项目索引：`.codemini-project/`
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
