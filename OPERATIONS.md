# Operations Guide

## Purpose

This document is the day-to-day operator guide for Codemini CLI.

Use it for:
- common commands
- interactive chat workflow
- plan/spec flow
- session recovery
- troubleshooting combos

Use [deployment.md](./deployment.md) for packaging, installation, and deployment instead.

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

### Sandbox (Windows / Linux / macOS)

The default model-facing command tool is `Bash` when Microsandbox is available. When `sandbox.enabled` is `auto` or `true`, Codemini prefers a Microsandbox Linux microVM with the workspace bind-mounted at `/workspace`. If the matching `msb` binary is missing or the VM cannot start, Linux and macOS fall back to OS confinement (Landlock / Seatbelt) on the host. Windows has no OS fallback: install Microsandbox, or set `sandbox.enabled false` for native PowerShell.

```bash
codemini config set sandbox.mode workspace-write   # default on every platform
codemini config set sandbox.mode read-only
codemini config set sandbox.mode danger-full-access
codemini config set sandbox.enabled false          # explicit host execution
codemini config set sandbox.backend auto           # default: VM when msb exists, else OS confine on unix
codemini config set sandbox.image node:22-bookworm
codemini config set sandbox.network allow-all      # default; 'none' denies all VM egress
```

| Mode | Effect |
| --- | --- |
| `workspace-write` | VM or OS confine with a writable workspace |
| `read-only` | VM or OS confine with a read-only workspace |
| `danger-full-access` | Explicit host execution without confinement |

| Network | Effect |
| --- | --- |
| `allow-all` (default) | VM has unrestricted egress (npm/pip/git/curl keep working) |
| `none` | VM denies all network egress (aliases: `deny-all`, `deny`) |

If an enabled sandbox cannot start and no OS fallback exists (Windows without `msb`), Codemini **refuses** to run the command on the host. `npm install` tries to select the matching Microsandbox platform package. Local microVMs require KVM on Linux, Apple Silicon on macOS, or Windows Hypervisor Platform on Windows 10+. Intel Macs typically use Seatbelt fallback. Run `npx microsandbox doctor` when the VM backend is selected. The first VM command pulls `sandbox.image`; later sandboxes reuse the image cache (a one-line pull notice is printed to stderr on first download). Cached sandbox VMs are stopped explicitly on clean process exit.

Approval and sandboxing remain separate: the microVM enforces the filesystem boundary, while approval mode controls whether an operation may be attempted. Windows keeps its staged write and `apply_patch` tools; only its default command surface changes from PowerShell to sandboxed Bash. When sandbox mode is `read-only`, soft approval is skipped and the approval selector is hidden.

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
/yes
/edit <feedback>
/reject
/plan from-spec <path?>
/agents list
/agents run <role> <task>
/compact
/retry
```

Note:
- The old manual `/tasks` board has been removed.
- For complex single-task work, the assistant now maintains an internal session todo checklist automatically and shows it in the TUI.
- `/plan auto run` is deprecated. Use `/plan auto <goal>` then `/yes`, `/edit <feedback>`, or `/reject`.

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

For auto plan approval flow:

```text
/plan auto <goal>
/yes
```

or revise/discard before execution:

```text
/edit <feedback>
/reject
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
codemini skill inspect my-skill
codemini skill install .\my-skill
codemini skill install --scope=global .\my-skill
codemini skill enable my-skill
codemini skill disable my-skill
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
