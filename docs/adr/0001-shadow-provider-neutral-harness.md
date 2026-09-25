---
status: accepted
---

# 采用默认关闭的 provider-neutral shadow harness

Codemini-CLI 的 harness 决策层采用 provider-neutral adapter，并以 `harness.enabled=false`、`mode=shadow` 作为默认配置。这样可以在不改变现有 Agent loop、审批、命令策略和沙箱行为的前提下比较 Rules、Jev 和 Laya；决策结果通过独立事件回调观察，只有在完成回放、校准和灰度后才允许影响 advisory 之外的控制流。

## Considered Options

- 直接让 Jev/Laya 改变工具调用和完成判定：反馈速度更快，但会绕过现有安全边界并使回滚困难。
- 只实现 Rules 分支、不保留 provider adapter：初期简单，但会把未来供应商切换和离线评测耦合到 runtime。
