<p align="center">
  <img src="./readme-assets/codemini-dark-deco-hero.webp" alt="Codemini 在雨夜的 Dark Deco 城市中工作" width="100%" />
</p>

<h1 align="center">Codemini</h1>

<p align="center">
  <b>把仓库留在手边。把选择留给自己。</b><br />
  <sub>一个运行在本机、同时工作在终端与浏览器里的 coding agent。</sub>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/codemini-cli"><img alt="npm version" height="24" src="https://img.shields.io/npm/v/codemini-cli?style=flat&logo=npm&logoColor=white&label=npm&labelColor=0f172a&color=cb3837"></a>
  <a href="https://nodejs.org"><img alt="node version" height="24" src="https://img.shields.io/badge/node-%3E%3D22.13-339933?style=flat&logo=nodedotjs&logoColor=white&labelColor=0f172a"></a>
  <a href="./LICENSE"><img alt="license" height="24" src="https://img.shields.io/badge/license-MIT-2563eb?style=flat&labelColor=0f172a"></a>
</p>

---

## 序章 / 凌晨两点

凌晨两点。雨点敲着窗，终端还停在那条找不到原因的报错上。

你启动了 Codemini。

它没有把你带去另一套工作区。程序在本机运行，会话、项目索引、技能和记忆也保存在本地。需要模型推理时，它会连接你配置的接口；工作现场仍然是眼前这台电脑。

想慢慢查，就打开 Web UI，把文件和线索逐一摊开。想直接交代一件事，就留在终端。入口不同，做事的规矩没有变：先弄清仓库，再决定下一步。

如果接下来的操作可能影响文件或系统，Codemini 会先停下来，把决定交还给你。

这就是 **Restrained by design**。

克制不是刻意少做，而是不在没有必要的时候多做。

---

<p align="center">
  <img src="./readme-assets/codemini-workflow-comic.webp" alt="Codemini 调查项目、等待确认并执行任务的三格漫画" width="100%" />
</p>

## Codemini 怎样工作

### 先找到入口

Codemini 会读取真实文件并建立项目索引，从入口、符号和依赖关系开始理解仓库。遇到问题时，它沿着证据往下查，而不是只凭文件名猜答案。

### 只带眼下需要的东西

Skills、记忆和工具按需加载。安装得再多，也不意味着每次对话都要把它们全部塞进上下文。

### 在动手之前停一下

读取、搜索和高风险操作有不同的处理方式。可能改变文件或系统的动作会进入审批，最终决定仍然在你手里。

### 在两个入口之间继续

终端适合快速下达任务，Web UI 适合长时间阅读、讨论和管理会话。它们使用同一套运行引擎，不是两套彼此割裂的工具。

---

## 第一话 / 接上线

你需要 Node.js 22.13+，以及一个可用的模型接口。

```bash
npm install -g codemini-cli

codemini config set gateway.base_url http://127.0.0.1:8000/v1
codemini config set gateway.api_key your_api_key
codemini config set model.name your_model_name

codemini --web
```

启动后，终端会显示 Web UI 的本地地址。

如果更习惯留在终端：

```bash
codemini
codemini run "阅读这个仓库，找出配置加载的入口，并解释它的调用流程。不要修改文件。"
```

第一次见面，不妨从一个简单的任务开始：

> 阅读 README 和项目结构，告诉我这个仓库解决什么问题，关键入口在哪里。暂时不要修改文件。

---

<details>
<summary><strong>English transmission</strong></summary>

### Keep the repository close. Keep the decisions yours.

Codemini is a local-first coding agent for both the terminal and the browser. Sessions, project indexes, skills, and memories are stored locally. When reasoning is needed, it calls the model endpoint you configured.

It reads the repository before acting, loads skills and context only when needed, and pauses for approval before potentially risky operations.

> **Restrained by design.** Not less capability—less unnecessary work.

Requires Node.js 22.13+.

```bash
npm install -g codemini-cli
codemini config set gateway.base_url http://127.0.0.1:8000/v1
codemini config set gateway.api_key your_api_key
codemini config set model.name your_model_name
codemini --web
```

</details>

---

<p align="center">
  <img src="./readme-assets/codemini-city-map.webp" alt="像项目依赖图一样延伸的雨夜 Dark Deco 城市" width="100%" />
</p>

## 档案

[使用手册](./OPERATIONS.md) · [部署指南](./deployment.md) · [MIT License](./LICENSE) · [报告问题](https://github.com/havingautism/Codemini-CLI/issues)

城市很大，仓库也是。先从一个入口开始。

```bash
codemini --web
```
