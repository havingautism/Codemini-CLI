# CodeMini CLI

[![English](https://img.shields.io/badge/README-English-0f172a?style=for-the-badge)](#english)
[![简体中文](https://img.shields.io/badge/README-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-2563eb?style=for-the-badge)](#简体中文)

## English

CodeMini CLI is a small-model-first coding assistant built for practical developer workflows, with a strong focus on Windows and PowerShell.

Instead of assuming frontier-sized models, long context windows, and Unix-first environments, CodeMini CLI is designed around what smaller coding models actually do well:
- minimal tool surface
- shell-first code exploration
- `rg`-driven search workflow
- PowerShell-aware command policy
- sub-agent isolation to reduce attention overload

### Why It Exists

Most coding CLIs are optimized for very large models and Unix-heavy setups. CodeMini CLI takes a different path:
- optimized for smaller internal models such as 7B to 30B
- tuned for Windows and PowerShell instead of treating them as second-class
- encourages high-signal command usage before falling back to heavier abstractions
- keeps the execution surface small and controllable

### Highlights

- Small-model first: default tools are intentionally minimal: `run_command`, `read_file`, `write_file`
- Windows optimized: `shell.default=powershell` switches prompt guidance and command allowlist to a PowerShell-friendly profile
- Search first: prefer `rg` for repo search, then local context commands, then file reads
- Safer by default: safe mode is on, with shell-aware allowlists and blocked command patterns
- Better sub-agents: child agents get scoped context packets instead of the full conversation history
- Tone customization: `soul` presets change reply tone without changing plans, code style, or execution logic

### Quick Start

```bash
codemini config set gateway.base_url http://your-internal-gateway/v1
codemini config set gateway.api_key your_token
codemini config set shell.default powershell
codemini config set model.name your-30b-model
codemini doctor
codemini chat
```

For macOS or Linux:

```bash
codemini config set shell.default bash
```

### Commands

```text
codemini chat [prompt]
codemini run <task>
codemini config set|get|list <key> [value]
codemini doctor
codemini skill list|install|enable|disable|inspect|reindex
```

### Default Behavior

- Default shell profile: `powershell` on Windows, `bash` elsewhere
- Default tools: `run_command`, `read_file`, `write_file`
- Default search strategy: `rg` first
- Default bundled skills:
  - `superpowers-lite`
  - `brainstorming-lite`
  - `executing-plan-lite`
- Default soul preset: `default`

### Safety

- `policy.safe_mode=true` by default
- command execution is filtered through shell-aware allowlists
- dangerous command patterns and protected paths are blocked
- `soul` affects reply tone only, not code generation logic

### Install

Offline package install:

```bash
npm i -g .\\codemini-cli-0.1.0.tgz
```

More packaging notes:
- [TGZ-README.md](/mnt/e/Git%20Projects/qurio-coder/TGZ-README.md)

### Data Layout

- Project-scoped workspace data: `.coder/`
- Global user data on Windows: `%APPDATA%\\codemini-cli\\`
- Restricted-environment fallback: `.codemini-cli/`

### Positioning

CodeMini CLI is a better fit if you want:
- stronger results from smaller coding models
- a Windows and PowerShell-friendly workflow
- command-line speed without exposing every possible tool to the model
- sub-agents that reduce noise instead of multiplying it

---

## 简体中文

CodeMini CLI 是一个专门为小模型优化的代码助手 CLI，重点针对 Windows 和 PowerShell 做了打磨。

它不是假设你在用超大模型、超长上下文、Unix-first 环境，而是围绕“小模型真正擅长什么”来设计：
- 更小的工具暴露面
- 更偏命令优先的代码检索方式
- `rg` 优先搜索
- PowerShell 感知的命令策略
- 更适合多 sub-agent，减少上下文注意力污染

### 为什么做这个

很多 coder CLI 更偏向：
- 超大模型
- macOS / Linux 优先
- 工具越多越好

CodeMini CLI 走的是另一条路：
- 更适合公司内部 7B 到 30B 级模型
- 把 Windows / PowerShell 当一等公民
- 先鼓励高信号命令，再按需读取文件
- 尽量缩小 LLM 的执行面，让行为更稳、更可控

### 主要特点

- 小模型优先：默认只暴露 `run_command`、`read_file`、`write_file`
- Windows 优化：`shell.default=powershell` 时自动切到 PowerShell 友好的提示词和 allowlist
- 搜索优先：优先用 `rg` 搜代码，再看局部上下文，最后才大段读取
- 默认更安全：safe mode 默认开启，按 shell 配置限制命令能力
- sub-agent 更干净：子代理默认拿受控上下文包，不继承整段会话历史
- 可定制语气：`soul` 只改回答风格，不改 plan、代码和执行逻辑

### 快速开始

```bash
codemini config set gateway.base_url http://your-internal-gateway/v1
codemini config set gateway.api_key your_token
codemini config set shell.default powershell
codemini config set model.name your-30b-model
codemini doctor
codemini chat
```

如果你在 macOS 或 Linux：

```bash
codemini config set shell.default bash
```

### 常用命令

```text
codemini chat [prompt]
codemini run <task>
codemini config set|get|list <key> [value]
codemini doctor
codemini skill list|install|enable|disable|inspect|reindex
```

### 默认行为

- 默认 shell profile：Windows 下优先 `powershell`，其他环境优先 `bash`
- 默认工具：`run_command`、`read_file`、`write_file`
- 默认搜索策略：优先 `rg`
- 默认内置 lite skills：
  - `superpowers-lite`
  - `brainstorming-lite`
  - `executing-plan-lite`
- 默认 soul：`default`

### 安全边界

- `policy.safe_mode=true`
- 命令执行会经过 shell-aware allowlist
- 危险命令模式和敏感系统路径会被拦截
- `soul` 只影响回答语气，不影响代码执行逻辑

### 安装

离线安装：

```bash
npm i -g .\\codemini-cli-0.1.0.tgz
```

详细打包说明：
- [TGZ-README.md](/mnt/e/Git%20Projects/qurio-coder/TGZ-README.md)

### 数据目录

- 项目工作区数据：`.coder/`
- Windows 全局用户数据：`%APPDATA%\\codemini-cli\\`
- 受限环境回退目录：`.codemini-cli/`

### 适合谁

如果你想要的是：
- 小模型也能更稳定地写代码
- Windows / PowerShell 不再是二等公民
- 命令行工作流足够快，而且可控
- sub-agent 真正帮你减轻注意力负担

那 CodeMini CLI 会更适合你。
