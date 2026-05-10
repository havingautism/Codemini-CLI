# Deployment Guide

This document describes how to package, copy, install, configure, and verify `codemini-cli` from a `.tgz` file.

## 1. Build The TGZ Package

Run this in the project root on the packaging machine:

```bash
npm pack
```

Expected output:

```text
codemini-cli-0.5.2.tgz
```

If you want to verify the package contents:

```bash
tar -tf codemini-cli-0.5.2.tgz
```

## 2. Copy To The Target Machine

Copy the generated `.tgz` file to the Win10 machine by one of these methods:

- company internal file share
- USB drive
- secure artifact repository
- SCP or similar internal transfer tool

Recommended target path:

```powershell
C:\temp\codemini-cli-0.5.2.tgz
```

## 3. Environment Requirements

Target machine requirements:

- Windows 10
- Node.js 22 or newer
- npm available
- PowerShell available

Check:

```powershell
node -v
npm -v
```

## 4. Install From TGZ

Global install:

```powershell
npm install -g C:\temp\codemini-cli-0.5.2.tgz
```

If global install is blocked by company policy, install in a working directory instead:

```powershell
mkdir C:\temp\coder-test
cd C:\temp\coder-test
npm install C:\temp\codemini-cli-0.5.2.tgz
```

## 5. Confirm Installation

If installed globally:

```powershell
codemini --help
```

If installed locally without global bin exposure:

```powershell
npx codemini --help
```

Or:

```powershell
node .\node_modules\codemini-cli\bin\coder.js --help
```

## 6. Initial Configuration

Set your internal gateway, key, model, and shell:

```powershell
codemini config set gateway.base_url https://your-internal-gateway/v1
codemini config set gateway.api_key your_token
codemini config set model.name your_model_id
codemini config set model.max_context_tokens 32768
codemini config set shell.default powershell
```

Optional but recommended:

```powershell
codemini config set gateway.timeout_ms 180000
codemini config set gateway.max_retries 2
```

Check current config:

```powershell
codemini config list
```

## 7. Smoke Test

Run the built-in environment check:

```powershell
codemini doctor
```

Then launch the TUI:

```powershell
codemini
```

Inside the TUI, test these:

```text
/config list
/history list
/spec 写一个Win10内部CLI权限规范
/plan from-spec
帮我创建一个 hello.js
读取 hello.js
```

## 8. Installed Data Locations

Project-scoped data:

```text
.coder\
```

Global user/tool data on Win10:

```text
%APPDATA%\codemini-cli\
```

Typical contents:

- `config.json`
- `sessions\`
- `skills\`
- project skills are stored per workspace under `.codemini\skills\`
- `input-history.json`

## 9. Skills

List installed skills:

```powershell
codemini skill list
```

Install a local skill into the current project:

```powershell
codemini skill install C:\path\to\skill-folder
```

Install a local skill globally:

```powershell
codemini skill install --scope=global C:\path\to\skill-folder
```

Rebuild the global registry:

```powershell
codemini skill reindex
```

## 10. Uninstall

Global uninstall:

```powershell
npm uninstall -g codemini-cli
```

Local uninstall inside a test directory:

```powershell
npm uninstall codemini-cli
```

## 11. Known Limitation

This `.tgz` package is suitable for package distribution, but it is not a fully self-contained offline dependency bundle.

If the target machine is completely air-gapped and does not already have the required npm dependencies available, prepare one of these instead:

- a tested `node_modules` bundle
- a company internal npm mirror
- a dedicated offline installer bundle
