<p align="center">
  <a href="https://github.com/havingautism/Codemini-CLI"><img src="./codemini-web/codemini_logo.png" alt="Codemini logo" width="160" /></a>
</p>

<h1 align="center">Codemini CLI</h1>

<p align="center">
  An extremely restrained coding + tasks CLI.<br />
  Every platform. Every terminal. Minimal by design.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/codemini-cli"><img alt="npm version" src="https://img.shields.io/npm/v/codemini-cli?style=flat-square&logo=npm"></a>
  <a href="https://nodejs.org"><img alt="node version" src="https://img.shields.io/badge/node-%3E%3D22.13-339933?style=flat-square&logo=nodedotjs&logoColor=white"></a>
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
  <a href="#terminal-tui--web-ui"><img alt="web ui included" src="https://img.shields.io/badge/Web_UI-included-7c3aed?style=flat-square"></a>
  <a href="#quick-start"><img alt="quick start" src="https://img.shields.io/badge/quick_start-4_commands-0ea5e9?style=flat-square"></a>
</p>

<p align="center">
  <a href="#english">English</a> ·
  <a href="#简体中文">简体中文</a> ·
  <a href="#terminal-tui--web-ui">Web UI</a> ·
  <a href="./OPERATIONS.md">Operator Guide</a> ·
  <a href="./deployment.md">Deployment</a>
</p>

---

## English

### What is Codemini?

Codemini is a **coding + tasks CLI** built around a simple premise: agentic help should work everywhere without wasting your context budget.

It can refactor a codebase, automate a Git workflow, run a multi-step pipeline, research a technical question, or process local files. It works on Windows, macOS, and Linux with OpenAI-compatible and Anthropic APIs.

Codemini provides two interfaces powered by the same runtime:

- A terminal TUI for focused, keyboard-first work.
- A browser Web UI for sessions, files, diffs, terminals, research, CodeWiki, skills, hooks, and settings.

Sessions, project state, skills, memories, and runtime metadata remain local. Model requests are sent only to the provider you configure.

### Why "Restrained"?

Codemini avoids making every feature part of every prompt.

- **Managed context.** Compaction, prompt preflight, and tool-result spill keep long sessions usable.
- **Lazy-loaded skills.** Routing metadata stays small; the complete `SKILL.md` is loaded only when selected.
- **Project-aware retrieval.** Symbols, AST structure, dependencies, and the project graph help locate evidence before reading large files.
- **Proportional approvals.** Read-only work can proceed while risky actions remain visible and reviewable.
- **Local persistence.** Sessions, memory, indexes, and checkpoints live on your machine.
- **Provider choice.** Use an OpenAI-compatible or Anthropic endpoint and configure a separate fast model when useful.

The goal is not fewer capabilities. It is less unnecessary context, guessing, and authority.

### Quick Start

Requires Node.js 22.13 or newer.

```bash
npm install -g codemini-cli

codemini config set gateway.base_url http://127.0.0.1:8000/v1
codemini config set gateway.api_key your_api_key
codemini config set model.name your_model_name

codemini doctor
codemini
```

Start the Web UI instead:

```bash
codemini --web
```

Or choose a project and port explicitly:

```bash
codemini web --project . --port 3456
```

### Beyond Code: Automated Tasks

`codemini run` turns a natural-language request into a one-off local workflow.

```bash
# Interactive session
codemini "Summarize the recent Git history and update CHANGELOG.md"

# One-off task
codemini run "Find stale dependencies and explain the upgrade risks"

# Role-constrained harness
codemini run --harness reviewer "Review the current changes"

# Sequential pipeline
codemini run --pipeline "Run tests, fix failures, and summarize the result"
```

| Command | Purpose |
| --- | --- |
| `codemini` / `codemini chat` | Start an interactive terminal session. |
| `codemini run <task>` | Run a one-off task. |
| `codemini run --harness <role> <task>` | Run with a specific harness role. |
| `codemini run --pipeline <task>` | Run a staged workflow with artifact passing. |
| `codemini --web` / `codemini web` | Start the local Web UI. |
| `codemini skill ...` | List, install, inspect, enable, disable, or reindex skills. |
| `codemini config ...` | Read or update configuration. |
| `codemini doctor` | Check the local runtime and configured provider. |

### Features

| What | Why it matters |
| --- | --- |
| **Project Intelligence** | File and symbol indexing, Tree-sitter AST queries, dependency graphs, project knowledge graphs, and CodeWiki. |
| **Structured Tool Runtime** | Validated tool schemas, deferred tools, parallel calls, plans, todos, subagents, and background tasks. |
| **Microsandbox** | Linux microVM when `msb` is available; Linux/macOS fall back to Landlock/Seatbelt. |
| **Approvals & Checkpoints** | Risk-aware approvals, file-change previews, Git-aware workflows, and checkpoints for non-Git projects. |
| **Terminal TUI** | Interactive chat, streaming tool output, syntax highlighting, and command shortcuts. |
| **Web UI** | Shared sessions, file browsing, diffs, real PTY terminals, research, CodeWiki, and configuration. |
| **Deep Research** | Parallel scouts, evidence collection, artifacts, Research Board, Scrapbook, and resource library. |
| **Skills, Hooks & MCP** | Reusable workflows, Claude-compatible hooks, hook profiles, and external MCP servers. |
| **Memory & Self-Evolution** | Capture, Dream, and Reflect turn useful work into curated memory and reusable skills. |
| **Souls** | Change expression and tone without changing execution policy. |
| **Local Persistence** | Durable sessions, project state, indexes, usage data, and recovery metadata. |
| **Provider Flexibility** | OpenAI-compatible and Anthropic providers, model-level reasoning controls, and an optional fast model. |

### Sandbox & Shell Behavior

When the sandbox is enabled, Codemini prefers a [Microsandbox](https://github.com/superradcompany/microsandbox) Linux microVM. If the platform `msb` binary is missing or the VM cannot start, Linux and macOS fall back to host OS confinement (Landlock / Seatbelt). Windows has no OS fallback.

- With Microsandbox, Bash and file tools start at the project root; use project-relative paths such as `src/core/tools.js`.
- OS fallback runs the host shell under Seatbelt or Landlock (not a Linux guest).
- Network access is available inside the sandbox.
- The host project is the writable workspace in `workspace-write` mode.
- If an enabled sandbox cannot start and no OS fallback exists, Codemini fails closed instead of silently running the command on the host.

When the sandbox is explicitly disabled:

| Host | Shell |
| --- | --- |
| Windows | Native PowerShell and the original host tools |
| macOS / Linux | Native Bash and the original host tools |

Available modes:

```bash
codemini config set sandbox.mode read-only
codemini config set sandbox.mode workspace-write
codemini config set sandbox.mode danger-full-access
codemini config set sandbox.enabled false
codemini config set sandbox.backend auto
```

Sandbox policy and approval policy are separate: the sandbox limits where a command can operate, while approvals decide whether it may run.

### Skills, Hooks & MCP

Skills are reusable, reviewable workflows. Codemini keeps lightweight routing metadata in global, coding, and daily indexes, then loads the complete skill only when needed.

```bash
codemini skill list
codemini skill install <source>
codemini skill inspect <name>
codemini skill enable <name>
codemini skill disable <name>
codemini skill reindex
```

Skills can be always active, selected by the agent, or invoked manually. Claude-compatible hooks and Hook Profiles can observe or gate lifecycle events, while MCP connects external tools without hard-coding them into the core runtime.

### Terminal TUI & Web UI

The terminal and browser use the same session engine.

```bash
codemini
codemini --web
```

The Web UI includes concurrent sessions, file browsing and previews, Git changes, a real PTY terminal, CodeWiki, Deep Research, Scrapbook, resource management, skills, hooks, MCP, Souls, memories, and settings.

Useful Web UI flags include `--port`, `--project`, `--session`, `--model`, and `--no-open`. The server binds `127.0.0.1` by default; pass `--host 0.0.0.0` to expose it on the LAN (no auth — do this only on trusted networks).

### Memory, Reflect & Dream

| Command | Purpose |
| --- | --- |
| `/capture <text>` | Save a useful signal to the memory inbox. |
| `/inbox` | Review pending memory evidence. |
| `/dream [--dry-run]` | Consolidate useful evidence into durable memory. |
| `/reflect` | Convert a successful workflow into a reviewable skill. |

The inbox is temporary by design. Dream promotes useful evidence; Reflect turns a repeatable workflow into an explicit tool that can be inspected and reused.

### Project Index, Graph & CodeWiki

Codemini incrementally indexes project files and symbols. Tree-sitter-based parsing supports precise AST and symbol queries, while dependency and knowledge graphs connect callers, files, and architectural areas.

CodeWiki presents this information as a navigable project map. Mutation preflight uses the graph before edits to surface likely downstream impact.

### Deep Research

Deep Research coordinates focused scouts, collects evidence, and produces reviewable artifacts. The Web UI adds a Research Board, Scrapbook, and resource library so sources and findings remain attached to the task instead of disappearing into chat history.

### Data Paths

| Scope | Path |
| --- | --- |
| Project state | `<project>/.codemini/` |
| Windows global state | `%APPDATA%\codemini-global\` |
| macOS global state | `~/Library/Preferences/codemini-global/` |
| Linux with XDG | `$XDG_CONFIG_HOME/codemini-global/` |
| Linux fallback | `~/.config/codemini-global/` |

Set `CODEMINI_GLOBAL_DIR` to override the global base directory.

### Optional Accelerators

`codemini doctor` detects optional local accelerators such as `fff-mcp` and falls back to built-in search when they are unavailable. `search.fff_command` may name a PATH program or an absolute executable outside the workspace; relative and workspace paths are rejected.

For JavaScript-heavy web pages, install Playwright and Chromium:

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

Build the bundled Web UI:

```bash
npm run build:web
```

### Documentation

- [Operator Guide](./OPERATIONS.md)
- [Deployment Guide](./deployment.md)
- [Releases](https://github.com/havingautism/Codemini-CLI/releases)

### License

[MIT](./LICENSE)

---

## 简体中文

### Codemini 是什么？

Codemini 是一款**刻意保持克制的 coding + tasks CLI**：让 Agent 在各个平台都能工作，同时不过度占用上下文。

它可以重构代码、自动化 Git 工作流、运行多步骤流水线、研究技术问题，也可以处理本地文件。支持 Windows、macOS 和 Linux，并兼容 OpenAI-compatible 与 Anthropic API。

Codemini 提供两个共享同一运行时的界面：

- 适合专注操作和键盘工作流的终端 TUI。
- 用于会话、文件、diff、终端、研究、CodeWiki、Skills、Hooks 和设置的浏览器 Web UI。

会话、项目状态、Skills、Memory 与运行时元数据保存在本机。只有模型请求会发送到你配置的服务商。

### 「克制」体现在哪里？

Codemini 不会让每项功能都进入每次提示词。

- **上下文可控。** 压缩、prompt preflight 与工具结果落盘让长会话保持可用。
- **Skills 懒加载。** 启动时只读取轻量路由信息，选中后才加载完整 `SKILL.md`。
- **按证据理解项目。** 符号、AST、依赖关系与项目图帮助 Agent 先定位，再读取必要文件。
- **审批与风险匹配。** 只读工作可以继续，危险操作保持可见、可审阅。
- **本地持久化。** 会话、记忆、索引和 checkpoint 留在本机。
- **模型自由。** 可使用 OpenAI-compatible 或 Anthropic 接口，也可以单独配置 fast model。

目标不是少做，而是减少不必要的上下文、猜测和权限。

### 快速开始

需要 Node.js 22.13 或更高版本。

```bash
npm install -g codemini-cli

codemini config set gateway.base_url http://127.0.0.1:8000/v1
codemini config set gateway.api_key 你的_API_Key
codemini config set model.name 你的模型名称

codemini doctor
codemini
```

启动 Web UI：

```bash
codemini --web
```

也可以明确指定项目和端口：

```bash
codemini web --project . --port 3456
```

### 不止写代码：自动化任务

`codemini run` 可以把自然语言请求变成一次性本地工作流。

```bash
# 交互式会话
codemini "总结最近的 Git 历史并更新 CHANGELOG.md"

# 一次性任务
codemini run "查找过期依赖并说明升级风险"

# 指定 Harness 角色
codemini run --harness reviewer "审查当前改动"

# 分阶段流水线
codemini run --pipeline "运行测试、修复失败并总结结果"
```

| 命令 | 用途 |
| --- | --- |
| `codemini` / `codemini chat` | 启动交互式终端会话。 |
| `codemini run <task>` | 执行一次性任务。 |
| `codemini run --harness <role> <task>` | 使用指定 Harness 角色执行任务。 |
| `codemini run --pipeline <task>` | 执行带产物传递的分阶段工作流。 |
| `codemini --web` / `codemini web` | 启动本地 Web UI。 |
| `codemini skill ...` | 查看、安装、检查、启用、禁用或重建 Skills 索引。 |
| `codemini config ...` | 读取或更新配置。 |
| `codemini doctor` | 检查本地运行时与模型服务。 |

### 功能速览

| 功能 | 说明 |
| --- | --- |
| **项目智能** | 文件与符号索引、Tree-sitter AST 查询、依赖图、项目知识图与 CodeWiki。 |
| **结构化工具运行时** | 工具 schema 校验、延迟工具、并行调用、计划、Todo、子 Agent 与后台任务。 |
| **Microsandbox** | 有 `msb` 时使用 Linux microVM；Linux/macOS 可回退到 Landlock/Seatbelt。 |
| **审批与 Checkpoint** | 风险审批、文件变更预览、Git 工作流与非 Git 项目的 checkpoint。 |
| **终端 TUI** | 交互式聊天、流式工具输出、语法高亮与命令快捷方式。 |
| **Web UI** | 共享会话、文件浏览、diff、真实 PTY 终端、研究、CodeWiki 与配置。 |
| **Deep Research** | 并行 scouts、证据收集、artifact、Research Board、Scrapbook 与资源库。 |
| **Skills、Hooks 与 MCP** | 可复用工作流、Claude-compatible Hooks、Hook Profiles 与外部 MCP 服务。 |
| **Memory 与自我进化** | Capture、Dream 和 Reflect 将工作沉淀为记忆与可复用 Skills。 |
| **Souls** | 只改变表达风格，不改变执行策略。 |
| **本地持久化** | 持久会话、项目状态、索引、用量与恢复元数据。 |
| **模型接入** | OpenAI-compatible 与 Anthropic provider、reasoning 控制和可选 fast model。 |

### 沙箱与 Shell 行为

开启沙箱后，Codemini 优先通过 [Microsandbox](https://github.com/superradcompany/microsandbox) 的 Linux microVM 执行命令。若本机没有对应的 `msb` 二进制或虚拟机无法启动，Linux 与 macOS 会回退到宿主 OS 隔离（Landlock / Seatbelt）。Windows 没有这套 OS 回退。

- 使用 Microsandbox 时，Bash 和文件工具都从项目根目录开始，使用 `src/core/tools.js` 这类项目相对路径。
- OS 回退在宿主 shell 上套 Seatbelt 或 Landlock，不是 Linux guest。
- 沙箱内允许网络访问。
- `workspace-write` 模式下，宿主项目是可写工作区。
- 如果要求启用沙箱但无法启动且没有 OS 回退，Codemini 会拒绝执行，而不会静默回退到无隔离的宿主机。

明确关闭沙箱后：

| 宿主系统 | Shell |
| --- | --- |
| Windows | 原生 PowerShell 与原版宿主工具 |
| macOS / Linux | 原生 Bash 与原版宿主工具 |

可用模式：

```bash
codemini config set sandbox.mode read-only
codemini config set sandbox.mode workspace-write
codemini config set sandbox.mode danger-full-access
codemini config set sandbox.enabled false
codemini config set sandbox.backend auto
```

沙箱策略与审批策略彼此独立：沙箱限制命令能在哪里操作，审批决定命令能否执行。

### Skills、Hooks 与 MCP

Skills 是可复用、可审阅的工作流。Codemini 将轻量路由元数据保存在 global、coding 和 daily 索引中，只在需要时加载完整 Skill。

```bash
codemini skill list
codemini skill install <source>
codemini skill inspect <name>
codemini skill enable <name>
codemini skill disable <name>
codemini skill reindex
```

Skills 可以始终启用、由 Agent 选择或手动调用。Claude-compatible Hooks 与 Hook Profiles 可以观察或拦截生命周期事件，MCP 则用于连接外部工具，而不需要把它们写死在核心运行时中。

### 终端 TUI 与 Web UI

终端与浏览器使用同一套会话引擎。

```bash
codemini
codemini --web
```

Web UI 包含并发会话、文件浏览与预览、Git 变更、真实 PTY 终端、CodeWiki、Deep Research、Scrapbook、资源管理、Skills、Hooks、MCP、Souls、Memory 与设置。

常用 Web UI 参数包括 `--port`、`--project`、`--session`、`--model` 和 `--no-open`。

### Memory、Reflect 与 Dream

| 命令 | 用途 |
| --- | --- |
| `/capture <text>` | 将有用信息保存到 Memory inbox。 |
| `/inbox` | 查看待整理的记忆证据。 |
| `/dream [--dry-run]` | 将有用证据整理成长期记忆。 |
| `/reflect` | 将成功工作流转化为可审阅的 Skill。 |

Inbox 被设计为临时区域。Dream 负责晋升有价值的证据；Reflect 将可重复的工作流变成可检查、可复用的明确工具。

### 项目索引、项目图与 CodeWiki

Codemini 会增量索引项目文件与符号。基于 Tree-sitter 的解析提供精确 AST 和符号查询，依赖图与知识图则连接调用方、文件和架构区域。

CodeWiki 将这些信息展示为可导航的项目地图。Mutation preflight 会在修改前查询图谱，提示可能受到影响的下游范围。

### Deep Research

Deep Research 会协调多个聚焦 scout、收集证据并生成可审阅 artifact。Web UI 提供 Research Board、Scrapbook 与资源库，让来源和结论继续附着在任务上，而不是消失在聊天记录里。

### 数据路径

| 范围 | 路径 |
| --- | --- |
| 项目状态 | `<project>/.codemini/` |
| Windows 全局状态 | `%APPDATA%\codemini-global\` |
| macOS 全局状态 | `~/Library/Preferences/codemini-global/` |
| 启用 XDG 的 Linux | `$XDG_CONFIG_HOME/codemini-global/` |
| Linux 回退路径 | `~/.config/codemini-global/` |

通过 `CODEMINI_GLOBAL_DIR` 可以覆盖全局基础目录。

### 可选增强

`codemini doctor` 会检测 `fff-mcp` 等本地可选加速器；不可用时自动回退到内置搜索。`search.fff_command` 只能是 PATH 中的程序名，或工作区之外的绝对路径；相对路径和工作区内的文件会被拒绝。

需要渲染 JavaScript 重度网页时，可以安装 Playwright 与 Chromium：

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

构建 Web UI：

```bash
npm run build:web
```

### 文档

- [使用手册](./OPERATIONS.md)
- [部署指南](./deployment.md)
- [Releases](https://github.com/havingautism/Codemini-CLI/releases)

### 许可证

[MIT](./LICENSE)
