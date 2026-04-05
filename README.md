# CodeMini CLI

[![English](https://img.shields.io/badge/README-English-0f172a?style=for-the-badge)](#english)
[![简体中文](https://img.shields.io/badge/README-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-2563eb?style=for-the-badge)](#简体中文)

## English

CodeMini CLI is a terminal coding assistant built for teams that want a smaller, sharper, and more controllable agent experience.

It is designed around a deliberate idea: most coding workflows do not need a huge default tool surface or unrestricted shell behavior. Instead, CodeMini starts with a compact core, loads advanced tools on demand, and keeps the agent grounded in structured code operations, session todos, lightweight project indexing, and shell-aware safety rules.

### Why CodeMini CLI

- Built for practical coding workflows, especially when smaller or internal models are part of the stack
- Keeps the default tool list intentionally small, with additional tools discoverable through `tool_search`
- Treats Windows and PowerShell as first-class environments instead of Linux-only afterthoughts
- Prefers structured file and code tools over noisy shell fallbacks
- Supports planning, execution, todo tracking, and sub-agent workflows without forcing a bloated interface

### What It Feels Like

- A coding CLI that is fast to steer
- A tool surface that is easier to audit and reason about
- A TUI that makes execution visible instead of hiding agent state
- A workflow that stays useful even when the model is not frontier-scale

### Core Capabilities

- Compact default tools for daily work:
  - `read`
  - `grep`
  - `list`
  - `query_project_index`
  - `edit`
  - `write`
  - `update_todos`
  - `run`
  - `tool_search`
- On-demand tools for advanced workflows:
  - `glob`
  - AST tools: `ast_query`, `read_ast_node`
  - diff tools: `generate_diff`, `patch`
  - background task management tools
  - persistent memory tools
- Session-scoped todo tracking through `update_todos`, rendered directly in the TUI
- Unified shell execution model:
  - one-shot commands through `run`
  - long-running commands through `run` with `run_in_background=true`
  - background task inspection through deferred tools when needed
- Lightweight project index in `.codemini-project/` for repository-aware prompting
- Tree-sitter-assisted structural editing for function/class/method scoped work
- Sub-agent support for planning, coding, review, and testing workflows
- Reply language control through `ui.reply_language`
- Tone presets through `soul`, without changing planning or code behavior

### Workflow Highlights

- `update_todos` is used for complex single-task work and rendered as a native checklist in the TUI
- `plan auto` is oriented toward task decomposition and execution sequencing
- `task`-level execution tracking is separated from `plan` and handled through the internal todo checklist
- The shell workflow is unified: the assistant no longer has to switch mental models between one-shot commands and long-running service tools
- The prompt explicitly teaches the model that the visible default tools are not the full tool universe; it should use `tool_search` when it needs more capability
- Slash completion includes prioritization, paging, and inline descriptions
- Safe mode is enabled by default

### Quick Start

```bash
codemini config set gateway.base_url http://your-internal-gateway/v1
codemini config set gateway.api_key your_token
codemini config set model.name your-30b-model
codemini config set shell.default powershell
codemini config set ui.reply_language zh
codemini doctor
codemini
```

For macOS or Linux:

```bash
codemini config set shell.default bash
```

### Commands

```text
codemini [prompt]
codemini chat [prompt]
codemini run <task>
codemini config set|get|list <key> [value]
codemini doctor
codemini skill list|install|enable|disable|inspect|reindex
```

### How The Tool Model Works

CodeMini CLI intentionally separates tools into two layers:

- Default tools:
  always visible, optimized for the most common coding path
- Deferred tools:
  loaded only when needed through `tool_search`

This keeps the main interface smaller and makes the agent's first-choice behavior more predictable.

Typical flow:

1. `query_project_index` or `list` to orient
2. `read` and `grep` to inspect
3. `edit` or `write` to change code
4. `run` to verify
5. `update_todos` to keep complex work legible
6. `tool_search` only when a more specialized capability is needed

### Project Index

CodeMini CLI maintains a lightweight project index inside `.codemini-project/`:

- `project-map.json`
  high-level repository facts such as languages, source roots, test roots, and entry candidates
- `file-index.json`
  per-file structure such as imports, exports, functions, classes, and lightweight symbol hints

The index is initialized when entering a project and refreshed incrementally after edits, writes, and patches. It is intended to be factual, compact, and cheap to keep current.

### Data Layout

- Session and project workspace state: `.codemini/`
- Lightweight project index: `.codemini-project/`
- Bundled repo skills: `skills/<name>/SKILL.md`
- Project-scoped skills: `.codemini/skills/<name>/SKILL.md`
- Global installed skills: `<base-config-dir>/skills/<name>/SKILL.md`

Base config directory resolution order:

- `CODEMINI_GLOBAL_DIR`
- Windows: `%APPDATA%\codemini-global\`
- macOS: `~/Library/Preferences/codemini-global`
- Linux / XDG: `$XDG_CONFIG_HOME/codemini-global`
- Restricted fallback: `.codemini-global/`

### Documentation

- Operator guide and workflow notes: [OPERATIONS.md](/mnt/e/Git%20Projects/qurio-coder/OPERATIONS.md)
- Packaging and deployment: [deployment.md](/mnt/e/Git%20Projects/qurio-coder/deployment.md)
- Release process: [RELEASE_CHECKLIST.md](/mnt/e/Git%20Projects/qurio-coder/RELEASE_CHECKLIST.md)

### Good Fit

CodeMini CLI is a strong fit if you want:

- a coding CLI that behaves well with smaller models
- a controlled tool surface instead of an everything-is-exposed agent
- Windows and PowerShell support that feels intentional
- a TUI that shows plans, todos, tools, and progress clearly
- a code assistant that prefers structured operations over shell noise

---

## 简体中文

CodeMini CLI 是一个面向真实开发环境的终端代码助手，目标不是“把所有能力都塞进默认界面”，而是做一个更克制、更清晰、更容易掌控的 coding agent CLI。

它围绕一个很明确的原则来设计：默认工具面尽量小，常用路径尽量顺，复杂能力按需加载。这样既更适合小模型，也更适合团队在内部环境里做稳定、可控的日常开发协作。

### 为什么是它

- 面向小模型和内部模型工作流优化，而不是默认假设超大模型能力
- 默认工具面刻意精简，需要更高级能力时再通过 `tool_search` 加载
- 把 Windows 和 PowerShell 当作一等公民来支持
- 优先走结构化代码工具，而不是让模型长期泡在嘈杂 shell 输出里
- 同时支持规划、执行、待办追踪和 sub-agent 协作，但不把界面做得臃肿

### 使用体验

- 更容易 steer 的 coding CLI
- 更容易审计和理解的工具面
- 更强调执行可视化的 TUI
- 即使模型不是 frontier 级别，也依然能稳定工作

### 核心能力

- 默认主工具保持在高频主路径：
  - `read`
  - `grep`
  - `list`
  - `query_project_index`
  - `edit`
  - `write`
  - `update_todos`
  - `run`
  - `tool_search`
- 更专业的能力按需加载：
  - `glob`
  - AST 工具：`ast_query`、`read_ast_node`
  - diff 工具：`generate_diff`、`patch`
  - 后台任务管理工具
  - 持久 memory 工具
- 通过 `update_todos` 维护复杂单任务的会话级待办清单，并直接渲染在 TUI 中
- 统一的 shell 执行模型：
  - 一次性命令直接 `run`
  - 长运行命令通过 `run` + `run_in_background=true`
  - 需要时再加载后台任务管理工具
- 在 `.codemini-project/` 下维护轻量项目索引，帮助模型更快理解仓库
- 基于 Tree-sitter 的结构化编辑能力，适合函数级、类级、方法级改动
- 支持 planner、coder、reviewer、tester 等 sub-agent 协作
- 支持通过 `ui.reply_language` 控制回复语言
- `soul` 只影响语气和表达，不改变计划或代码行为

### 工作流亮点

- 复杂单任务会使用 `update_todos`，并在 TUI 里以原生 checklist 方式展示
- `plan auto` 专注于任务拆解、顺序和执行编排
- 单任务内部的执行推进则由 todo checklist 负责，不和 `plan` 混在一起
- shell 模型已经统一，不再需要在“一次性命令”和“长运行服务工具”之间切换心智
- prompt 会明确告诉模型：默认看到的工具不是全部工具，缺能力时先 `tool_search`
- slash 补全支持优先级、分页和简短说明
- safe mode 默认开启

### 快速开始

```bash
codemini config set gateway.base_url http://your-internal-gateway/v1
codemini config set gateway.api_key your_token
codemini config set model.name your-30b-model
codemini config set shell.default powershell
codemini config set ui.reply_language zh
codemini doctor
codemini
```

如果你在 macOS 或 Linux：

```bash
codemini config set shell.default bash
```

### 命令概览

```text
codemini [prompt]
codemini chat [prompt]
codemini run <task>
codemini config set|get|list <key> [value]
codemini doctor
codemini skill list|install|enable|disable|inspect|reindex
```

### 工具模型怎么设计

CodeMini CLI 把工具分成两层：

- 默认工具
  永远可见，覆盖最常见的编码主路径
- 延迟工具
  只有在需要时才通过 `tool_search` 加载

这样做的目标，是让主界面更小、更稳，也让模型在第一反应时更容易走对路径。

典型流程通常是：

1. `query_project_index` 或 `list` 做定位
2. `read` 和 `grep` 做理解
3. `edit` 或 `write` 做改动
4. `run` 做验证
5. `update_todos` 追踪复杂任务
6. 真的需要专门能力时，再 `tool_search`

### 项目索引

CodeMini CLI 会在 `.codemini-project/` 下维护一份轻量项目索引：

- `project-map.json`
  记录仓库的高层结构事实，比如语言、源码目录、测试目录、入口候选
- `file-index.json`
  记录文件级结构信息，比如 imports、exports、functions、classes 和轻量 symbol 提示

这份索引会在进入项目时初始化，在 `edit`、`write`、`patch` 后做增量刷新。它的目标是轻量、可靠、低噪声，而不是生成一份很长的 AI 报告。

### 数据目录

- 会话和项目工作区状态：`.codemini/`
- 轻量项目索引：`.codemini-project/`
- 仓库内置 skill：`skills/<name>/SKILL.md`
- 项目级 skill：`.codemini/skills/<name>/SKILL.md`
- 全局已安装 skill：`<base-config-dir>/skills/<name>/SKILL.md`

`base-config-dir` 的解析顺序：

- `CODEMINI_GLOBAL_DIR`
- Windows：`%APPDATA%\codemini-global\`
- macOS：`~/Library/Preferences/codemini-global`
- Linux / XDG：`$XDG_CONFIG_HOME/codemini-global`
- 受限环境回退：`.codemini-global/`

### 文档入口

- 操作手册与工作流说明：[OPERATIONS.md](/mnt/e/Git%20Projects/qurio-coder/OPERATIONS.md)
- 打包与部署文档：[deployment.md](/mnt/e/Git%20Projects/qurio-coder/deployment.md)
- 发布流程：[RELEASE_CHECKLIST.md](/mnt/e/Git%20Projects/qurio-coder/RELEASE_CHECKLIST.md)

### 适合谁

如果你想要的是下面这种工具，CodeMini CLI 会很合适：

- 能和小模型稳定协作的 coding CLI
- 更克制、更可控的工具暴露方式
- 真正重视 Windows / PowerShell 体验的终端工作流
- 能把计划、待办、工具调用和执行状态展示清楚的 TUI
- 更偏结构化操作、而不是大量 shell 噪声的代码助手
