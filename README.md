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

- Minimal default tools: `run_command`, `read_file`, `write_file`
- Windows-aware shell profile with PowerShell-focused defaults
- Safe mode enabled by default
- Built-in lite skills for planning, execution, and collaboration
- Tone presets through `soul`, without changing plans or code behavior
- Sub-agents for planning, coding, review, and testing

### Quick Start

```bash
codemini config set gateway.base_url http://your-internal-gateway/v1
codemini config set gateway.api_key your_token
codemini config set shell.default powershell
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

### Documentation

- Operator guide and common command patterns: [OPERATIONS.md](/mnt/e/Git%20Projects/qurio-coder/OPERATIONS.md)
- Packaging and deployment guide: [deployment.md](/mnt/e/Git%20Projects/qurio-coder/deployment.md)

### Data Layout

- Project-scoped workspace data: `.coder/`
- Global user data on Windows: `%APPDATA%\\codemini-cli\\`
- Restricted-environment fallback: `.codemini-cli/`

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

- 默认工具极简：`run_command`、`read_file`、`write_file`
- 面向 Windows 的 PowerShell 默认配置
- safe mode 默认开启
- 内置 lite skills，覆盖规划、执行和协作
- `soul` 只影响语气，不影响计划和代码行为
- 支持 planner、coder、reviewer、tester 多角色 sub-agent

### 快速开始

```bash
codemini config set gateway.base_url http://your-internal-gateway/v1
codemini config set gateway.api_key your_token
codemini config set shell.default powershell
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

### 文档入口

- 操作手册与常见命令组合：[OPERATIONS.md](/mnt/e/Git%20Projects/qurio-coder/OPERATIONS.md)
- 打包与部署手册：[deployment.md](/mnt/e/Git%20Projects/qurio-coder/deployment.md)

### 数据目录

- 项目工作区数据：`.coder/`
- Windows 全局用户数据：`%APPDATA%\\codemini-cli\\`
- 受限环境回退目录：`.codemini-cli/`
