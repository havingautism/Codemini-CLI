# Codemini CLI

Codemini 是一款本地优先的 coding + tasks CLI：终端 TUI 与 Web UI 共享同一运行时，会话、记忆、索引等状态保存在本机，仅模型请求发往服务商。

## Language

**状态栏（Status Bar）**:
两个界面底部的一行运行时摘要条，展示模型、provider、上下文占用、活动状态等，并承载时间戳、工具调用计数、todo 徽章等轻量指标。
_Avoid_: 状态条、状态指示器

**运行时状态快照（Runtime State Snapshot）**:
状态栏所渲染的唯一状态对象，一份数据同时驱动 Web UI 与 TUI。
_Avoid_: state、状态（有歧义时）

**状态更新（State Update）**:
状态栏数据重新计算并刷新的时机，是所有动态指标（时间戳、工具调用计数）的刷新边界。

**工具调用计数（Tool Call Count）**:
按工具类型分组统计的本会话工具执行次数，失败与被拦截的执行同样计入。

**错误记录（Error Log）**:
本会话内工具执行失败的记录。状态栏与快照中只保留最近 3 条的摘要（错误类型 + 100 字以内的消息），完整堆栈仅按需加载、不常驻。
_Avoid_: 错误历史常驻、完整 traceback 进快照

**截断占位符（Truncation Placeholder）**:
长内容被裁剪后用于占位的标记（如 "[Truncated: N lines omitted]"），压缩与会话重建时必须保持字节级一致。
_Avoid_: 动态文案、每次重算

**系统环境信息（System Environment Info）**:
运行环境的静态事实集合（平台、Node 版本、Shell、沙箱模式、项目路径、Git 状态、模型、provider、执行模式）。
