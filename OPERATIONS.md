# Operations Guide

## Purpose

This document is the day-to-day operator guide for Codemini CLI.

Use it for:
- common commands
- interactive chat workflow
- execution modes and approvals
- session recovery
- troubleshooting combos

Use [deployment.md](./deployment.md) for packaging, installation, and deployment instead.

## Core Commands

```text
codemini [prompt] [--plain] [--model <name>] [--fast]
codemini chat [prompt] [--session <id>] [--plain] [--model <name>] [--fast]
codemini run <task> [--model <name>] [--fast]
codemini run --harness <role> <task> [--model <name>] [--fast]
codemini run --pipeline <task> [--model <name>] [--fast]
codemini web [--port <port>] [--project <path>] [--session <id>] [--model <name>] [--no-open] [--host <addr>]
codemini config set|get|list|reset <key> [value]
codemini doctor
codemini skill list|install|update|enable|disable|inspect|reindex
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

### Change runtime settings quickly

```powershell
codemini config set shell.default powershell
codemini config set ui.language en
codemini config set soul.coding professional
codemini config set soul.daily playful
```

```bash
codemini config set shell.default bash
codemini config set ui.language zh
```

Soul config uses `soul.coding` (coding mode) and `soul.daily` (daily mode). The old `soul.preset` key is migrated automatically if still present.

### Execution modes

Two modes are available (`execution.mode`): `normal` and `plan`.

```bash
codemini config set execution.mode normal   # daily chat and lighter tasks
codemini config set execution.mode plan     # code-focused work with direct editing and optional subagents
```

Approval modes (`execution.approval_mode`): `review`, `auto`, `full_access`.

```bash
codemini config set execution.approval_mode review
codemini config set execution.approval_mode auto
codemini config set execution.approval_mode full_access
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

The terminal TUI recognizes these slash commands (type `/` for the autocomplete list):

```text
/compact   compress the current conversation context
/dream     consolidate memory inbox evidence into durable memory
/reflect   turn the current workflow into a reviewable skill
/inbox     show the memory inbox
/coding    switch to coding mode
/daily     switch to daily mode
/tools     expand or collapse process details
/history   open session history
/help      show keyboard shortcuts
```

In the input line:

- `/` opens the command autocomplete list.
- `@` references a workspace file.
- `!` runs a shell command.

Note:
- The old manual `/tasks` board has been removed.
- For complex single-task work, the assistant maintains an internal session todo checklist automatically and shows it in the TUI.
- Plan/spec flows are driven by execution mode and tool calls, not by TUI slash commands; see [Plan and spec flow](#plan-and-spec-flow).

Available harness roles for `codemini run --harness <role>`:

```text
explorer
architect
advisor
coder
refactorer
reviewer
tester
debugger
writer
summarizer
```

## Useful Workflows

### Repo exploration

```text
Search the README for skill-related documentation.
Continue into the relevant files and explain how skill loading works.
Find where shell.default is used and summarize the config path.
```

### Plan and spec flow

Codemini has two execution modes (`execution.mode`): `normal` (Daily) and `plan` (Coding). In plan mode the agent drafts a plan or spec, surfaces it for review, and proceeds after approval.

In the Web UI, pending plan and spec reviews appear as dialogs (Plan review / Spec approval) with confirm, edit, and discard actions. In the TUI, switch mode with `/coding` or `/daily`, and approve or reject tool-level approvals with the approval dialog.

`create_spec` is a legacy tool kept for existing callers; prefer writing markdown under `.codemini/workspace/specs/` and implementing directly. `create_plan` has been retired — use `run_subagent` for isolated chunks or implement directly.

### Session recovery

```text
/history
```

opens the session history picker; select a session to resume it.

You can also load a specific session directly:

```powershell
codemini chat --session <session_id>
codemini web --session <session_id>
```

### Skill management

```powershell
codemini skill list
codemini skill inspect my-skill
codemini skill install .\my-skill
codemini skill install --no-hooks .\my-skill
codemini skill update my-skill
codemini skill enable my-skill
codemini skill disable my-skill
codemini skill reindex
```

- `install` supports `--no-hooks` (skip bundled hooks); it installs into the global skills directory.
- `list` and `inspect` accept `--scope=all|global|builtin`.
- `update <name>` refreshes a skill installed from a git/package source.

## Better Prompt Patterns

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

From the `/help` dialog:

| Key | Action |
| --- | --- |
| `Enter` | Send |
| `Ctrl+Enter` | Send / jump queue |
| `Shift+Enter` / `Ctrl+J` | New line |
| `↑` / `↓` | Input history |
| `Wheel` / `Shift+↑` / `Shift+↓` | Scroll conversation |
| `PageUp` / `PageDown` | Scroll one page |
| `Ctrl+Shift+↑` / `Ctrl+Shift+↓` | Jump prompts |
| `/` | Commands autocomplete |
| `Ctrl+O` / `/tools` | Process details |
| `Ctrl+T` | Body only / full view |
| `Esc` | Stop / home |
| `Ctrl+C` | Clear / exit |

## Release Management

### Release Checklist

For information on how to perform a release, please see the [Release Checklist](RELEASE_CHECKLIST.md) document.
