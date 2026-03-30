# CodeMini CLI

[![English](https://img.shields.io/badge/README-English-0f172a?style=for-the-badge)](#english)
[![简体中文](https://img.shields.io/badge/README-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-2563eb?style=for-the-badge)](#简体中文)

## English

CodeMini CLI is a coding assistant CLI optimized for small-model workflows, with a strong focus on Windows and PowerShell.

It is designed for teams that want a coding assistant that feels practical, controllable, and fast in real development environments, especially when smaller internal models are part of the workflow.

### Why CodeMini CLI

- Optimized for small-model workflows rather than assuming frontier-scale reasoning
- Built with Windows and PowerShell as first-class environments
- Keeps the default tool surface intentionally small and easier to control
- Uses shell-aware execution policy instead of exposing unrestricted system access
- Supports sub-agent workflows without forcing full-history context sharing

### Highlights

- Minimal default tools: `run`, `read`, `write`
- Windows-aware shell profile with PowerShell-focused defaults
- Safe mode enabled by default
- Built-in lite skills for planning, execution, and collaboration
- Configurable reply language through `ui.reply_language` (`zh` / `en`)
- Richer slash completion with priority sorting, inline descriptions, and left/right paging
- Structured code tools for small models: `grep`, `read`, `edit`
- Tree-sitter AST tools for small models: `ast_query`, `read_ast_node`, node-scoped `edit`
- More conservative `plan auto` acceptance checks with reviewer/tester goal checklists
- Tone presets through `soul`, without changing plans or code behavior
- Example soul presets include `professional`, `playful`, `anime`, `pirate`, `caveman`, and `ceo`
- Sub-agents for planning, coding, review, and testing

### Quick Start

```bash
codemini config set gateway.base_url http://your-internal-gateway/v1
codemini config set gateway.api_key your_token
codemini config set shell.default powershell
codemini config set ui.reply_language zh
codemini config set model.name your-30b-model
codemini doctor
codemini
```

For macOS or Linux:

```bash
codemini config set shell.default bash
```

### Command Overview

```text
codemini [prompt]
codemini chat [prompt]
codemini run <task>
codemini config set|get|list <key> [value]
codemini doctor
codemini skill list|install|enable|disable|inspect|reindex
```

### Notable Workflow Features

- `ui.reply_language` controls the assistant reply language at the prompt layer and also nudges generated docs and code comments to match
- Slash completion now prioritizes important commands and config keys, shows short descriptions, and supports `←/→` page switching
- Ambiguous feature requests can pause for lightweight brainstorming first, and `/brainstorm <question>` gives an explicit way to compare options before coding
- `plan auto` now turns the original goal into an acceptance checklist, uses a lighter chain only for truly tiny tasks, and treats unmet checklist items as failure signals
- Structured code tools reduce shell-noise for small models by preferring `grep/read -> edit`
- Tree-sitter-aware code tools support `grep/read -> ast_query/read_ast_node -> edit(ast_target)` for function/class-level edits with explicit node range limits
- Current Tree-sitter language support includes JavaScript/JSX, TypeScript/TSX, Python, Go, C, C++, Bash, Java, Rust, C#, PHP, and Ruby

### Skill Loading

CodeMini CLI loads skills from these locations:

- Bundled repo skills: `skills/<name>/SKILL.md`
- Installed global skills: `<base-config-dir>/skills/<name>/SKILL.md`
- Project-scoped skills: `.codemini/skills/<name>/SKILL.md`

The base config directory is resolved in this order:

- `CODEMINI_GLOBAL_DIR`
- Windows: `%APPDATA%\\codemini-global\\`
- macOS: `~/Library/Preferences/codemini-global`
- Linux/XDG: `$XDG_CONFIG_HOME/codemini-global`
- Fallback in restricted environments: `.codemini-global/`

### Brainstorming

Use `/brainstorm <question>` when you want the assistant to stop before coding, compare 2-3 approaches, and choose one direction first.

```text
/brainstorm Should login retry stay local or become a shared helper?
```

### Documentation
### Release Checklist

For information on how to perform a release, please see the [Release Checklist](RELEASE_CHECKLIST.md) document.


- Operator guide and common command patterns: [OPERATIONS.md](/mnt/e/Git%20Projects/qurio-coder/OPERATIONS.md)
- Packaging and deployment guide: [deployment.md](/mnt/e/Git%20Projects/qurio-coder/deployment.md)

### Data Layout

- Project-scoped workspace data: `.codemini/`
- Global user data on Windows: `%APPDATA%\\codemini-global\\`
- Restricted-environment fallback: `.codemini-global/`

### Project Index

CodeMini CLI now maintains a lightweight project index inside `.codemini-project/`:

- `project-map.json` for project skeleton metadata such as languages, important files, source roots, test roots, and entry candidates
- `file-index.json` for per-file symbols, imports, exports, functions, classes, and basic call hints

The index is initialized once when entering a project and refreshed incrementally after code edits, writes, and patches. Session data stays in `.codemini/`; project structure lives in `.codemini-project/`. The index is intentionally lightweight and fact-based rather than an LLM-generated project report.
At request time, CodeMini injects a short project-context summary from this index into the model prompt instead of dumping the full index.

### Positioning

CodeMini CLI is a better fit if you want:
- a coding CLI that behaves well with smaller models
- a Windows and PowerShell-friendly workflow
- a more controlled execution surface
- multi-agent execution with stronger review and verification steps

---

## 简体中文

CodeMini CLI 是一个为小模型工作流优化过的代码助手 CLI，重点针对 Windows 和 PowerShell 做了打磨。

它更适合那些希望代码助手在真实开发环境里更稳、更可控、更实用的团队，尤其是在内部小模型参与日常工作的场景下。

### 为什么做这个

- 面向小模型工作流优化，而不是默认假设超大模型能力
- 把 Windows 和 PowerShell 当作一等公民
- 默认工具面更小，更容易控制
- 使用 shell-aware 的执行策略，而不是无边界暴露系统能力
- 支持 sub-agent 协作，但不会强制共享整段上下文历史

### 主要特点

- 默认工具极简：`run`、`read`、`write`
- 面向 Windows 的 PowerShell 默认配置
- safe mode 默认开启
- 内置 lite skills，覆盖规划、执行和协作
- 支持通过 `ui.reply_language` 配置回复语言，当前支持 `zh` / `en`
- slash 补全支持优先级排序、右侧简短说明和左右分页
- 为小模型补了结构化代码工具：`grep`、`read`、`edit`
- 为小模型补了 Tree-sitter AST 工具：`ast_query`、`read_ast_node`，以及带 node 范围限制的 `edit`
- `plan auto` 会基于原始目标生成验收清单，并更保守地处理 reviewer/tester 结果
- `soul` 只影响语气，不影响计划和代码行为
- 可用的 `soul` 示例包括 `professional`、`playful`、`anime`、`pirate`、`caveman`、`ceo`
- 支持 planner、coder、reviewer、tester 多角色 sub-agent

### 快速开始

```bash
codemini config set gateway.base_url http://your-internal-gateway/v1
codemini config set gateway.api_key your_token
codemini config set shell.default powershell
codemini config set ui.reply_language zh
codemini config set model.name your-30b-model
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

### 近期工作流增强

- `ui.reply_language` 通过 prompt 层控制模型回复语言，也会尽量让生成文档和代码注释跟随该语言
- slash 补全会优先展示更重要的命令和配置项，显示简短说明，并支持 `←/→` 翻页
- 对于需求仍不明确的功能请求，CLI 会先偏向轻量 brainstorm；也可以显式使用 `/brainstorm <问题>` 先比较方案再决定是否编码
- `plan auto` 会先把原始目标展开成验收清单；只有真正很小的任务才会走轻量链路；如果 reviewer 或 tester 标记了未满足或未验证的验收项，就不会按成功处理
- 为了减少小模型被 shell 原始输出干扰，新增了 `grep/read -> edit` 这套结构化代码工具流
- 现在也支持 `grep/read -> ast_query/read_ast_node -> edit(ast_target)` 这套 AST 工作流，适合函数级/类级精准编辑，并且能限制小模型只能修改显式选中的 node 范围
- 当前内置的 Tree-sitter 语言支持包括 JavaScript/JSX、TypeScript/TSX、Python、Go、C、C++、Bash、Java、Rust、C#、PHP、Ruby

### Skill 加载位置

CodeMini CLI 会从这些位置读取 skill：

- 仓库内置 skill：`skills/<name>/SKILL.md`
- 全局已安装 skill：`<base-config-dir>/skills/<name>/SKILL.md`
- 项目级 skill：`.codemini/skills/<name>/SKILL.md`

`base-config-dir` 的解析顺序是：

- `CODEMINI_GLOBAL_DIR`
- Windows：`%APPDATA%\\codemini-global\\`
- macOS：`~/Library/Preferences/codemini-global`
- Linux / XDG：`$XDG_CONFIG_HOME/codemini-global`
- 受限环境回退：`.codemini-global/`

### Brainstorm 用法

当你希望助手先收敛方向、不要立即写代码时，可以使用：

```text
/brainstorm Should login retry stay local or become a shared helper?
```

### 文档入口

- 操作手册与常见命令组合：[OPERATIONS.md](/mnt/e/Git%20Projects/qurio-coder/OPERATIONS.md)
- 打包与部署手册：[deployment.md](/mnt/e/Git%20Projects/qurio-coder/deployment.md)

### 数据目录

- 项目工作区数据：`.codemini/`
- Windows 全局用户数据：`%APPDATA%\\codemini-global\\`
- 受限环境回退目录：`.codemini-global/`

### 项目索引

CodeMini CLI 现在会在 `.codemini-project/` 下维护一份轻量项目索引：

- `project-map.json`：记录项目骨架信息，例如语言、关键文件、源码目录、测试目录、入口候选
- `file-index.json`：记录文件级结构信息，例如 symbols、imports、exports、functions、classes、基础 calls

这份索引会在进入项目时初始化一次，在 `edit`、`write`、`patch` 后做增量刷新。`.codemini/` 继续保存会话态数据，`.codemini-project/` 保存项目结构索引。它是程序维护的轻量事实索引，不是模型生成的项目总结。
在真正请求模型时，CodeMini 会从这份索引里裁一小段项目摘要注入 prompt，而不是把整份索引直接塞进去。
