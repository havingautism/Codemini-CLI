# Operations Guide

## Purpose

This document is the day-to-day operator guide for CodeMini CLI.

Use it for:
- common commands
- interactive chat workflow
- plan/spec flow
- session recovery
- troubleshooting combos

Use [deployment.md](/mnt/e/Git%20Projects/qurio-coder/deployment.md) for packaging, installation, and deployment instead.

## Core Commands

```text
codemini [prompt]
codemini chat [prompt]
codemini run <task>
codemini config set|get|list <key> [value]
codemini doctor
codemini skill list|install|enable|disable|inspect|reindex
```

## First-Time Setup

### Windows / PowerShell

```powershell
codemini config set gateway.base_url https://your-internal-gateway/v1
codemini config set gateway.api_key your_token
codemini config set model.name your_model_id
codemini config set shell.default powershell
codemini config set ui.language en
codemini doctor
```

### macOS / Linux

```bash
codemini config set gateway.base_url https://your-internal-gateway/v1
codemini config set gateway.api_key your_token
codemini config set model.name your_model_id
codemini config set shell.default bash
codemini config set ui.language en
codemini doctor
```

## Common Command Combos

### Start an interactive session

```powershell
codemini
```

Good first prompts:

```text
Read the README and summarize what this repository does.
Search for auth-related code and show me the key entrypoints.
Locate where shell.default is applied and explain the flow.
```

### Run a one-off task

```powershell
codemini run "Search the repo for configuration loading logic, inspect the relevant files, and summarize how config is merged."
```

### Inspect current configuration

```powershell
codemini config get shell.default
codemini config get model.name
codemini config get ui.language
codemini config list
```

### Change runtime mode quickly

```powershell
codemini config set shell.default powershell
codemini config set ui.language en
codemini config set soul.preset professional
codemini config set soul.preset pirate
```

```bash
codemini config set shell.default bash
codemini config set ui.language zh
```

### Run diagnostics

```powershell
codemini doctor
codemini config list
codemini --plain
```

Use this when you want to separate:
- gateway issues
- config issues
- TUI-only issues

## TUI Slash Commands

```text
/help
/commands
/brainstorm <question>
/config list
/config get <key>
/history list
/history current
/history resume <session_id>
/spec <topic>
/plan <goal>
/plan auto <goal>
/plan from-spec <path?>
/agents list
/agents run <role> <task>
/compact
/retry
```

Available sub-agent roles:

```text
planner
coder
reviewer
tester
```

## Useful Workflows

### Repo exploration

```text
Search the README for skill-related documentation.
Continue into the relevant files and explain how skill loading works.
Find where shell.default is used and summarize the config path.
```

### Brainstorm before coding

```text
/brainstorm Should login retry stay local or become a shared helper?
```

Use this when the implementation path is still fuzzy and you want the CLI to compare a few approaches before any code change.

### Spec and plan flow

```text
/spec Write a Windows PowerShell-first coding CLI usage spec
/plan from-spec
```

Then continue with:

```text
Execute this plan step by step.
```

### Session recovery

```text
/history list
/history current
/history resume <session_id>
```

### Skill management

```powershell
codemini skill list
codemini skill inspect superpowers-lite
codemini skill enable brainstorm
codemini skill disable brainstorm
codemini skill reindex
```

## Better Prompt Patterns
## Release Management

### Release Checklist

For information on how to perform a release, please see the [Release Checklist](RELEASE_CHECKLIST.md) document.


These usually work better:

- `Search for auth-related code, inspect the most relevant files, then summarize the login flow.`
- `Locate where shell.default takes effect and point me to the key files.`
- `Update the README so English is first, but keep a Chinese section below.`
- `Investigate why run_command keeps failing. Check config first, then the execution chain.`

These are usually weaker:

- `Look at this project.`
- `Optimize this.`

Better prompts usually specify:
- what to search
- what to inspect
- what output format you want back

## TUI Keys

- `Tab`: autocomplete slash commands
- `Up/Down`: navigate input history
- `Ctrl+T`: expand or collapse tool details
- `Ctrl+C`: exit
