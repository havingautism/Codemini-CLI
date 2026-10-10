# 记忆与 Skill 沉淀判断

在 Web UI 的「设置 → 决策」配置 Jev 或 Laya，启用任务决策助手，再分别开启「记忆沉淀判断」和「Skill 沉淀判断」。两项默认关闭；开启后默认使用观察模式。

CLI 对应配置：

```powershell
codemini config set harness.distillation.memory_enabled true
codemini config set harness.distillation.skill_enabled true
codemini config set harness.distillation.mode shadow
codemini config set harness.distillation.confidence_threshold 0.8
codemini config set harness.distillation.max_candidates 8
```

这些功能复用 `harness.provider` 的连接、超时和灰度范围，要求 `harness.enabled=true` 且外部服务已配置。`rules` 不调用沉淀决策。记忆提取仍受 `memory.enabled`、`memory.writeback.enabled` 和 `memory.background_review.enabled` 控制。

观察模式只记录判断，不改变原来的提取和候选结果。设置 `harness.distillation.mode=filter` 后，可以跳过高置信度不值得提取的会话，并过滤高置信度无复用价值或重复的候选。阈值范围为 0.5–1：默认 0.8 意味着“无复用价值”或“重复”的概率至少为 80% 才过滤。会话预判断的输入不完整或含敏感内容时不跳过提取；候选正文被裁剪或含敏感内容时不直接过滤该候选。服务异常、弃权和不确定判断保留原流程。

后台记忆审核先判断是否值得调用提取模型，再对通过现有证据检查的候选批量判断。重复比较包含当前项目及用户/全局记忆和相关收件箱条目，候选仍只进入 Dream 收件箱，不直接晋升为长期记忆。

Skill 判断接在 Reflect 草稿流程中。无明确请求时先判断工作流是否值得提取；有明确请求或修订反馈时始终生成草稿，只观察候选判断。生成后的草稿与已索引 Skill 做重复比较，写入仍由原有 Write/Revise/Discard 流程确认。这不会在每轮聊天后自动创建 Skill。

每个候选同时判断复用价值、重复概率和最窄适用范围。范围是建议，不自动更改记忆作用域或 Skill 安装位置。每次最多判断 1–16 个候选，默认 8，超出部分保留原流程。输入按预算分块；决策结果和输入哈希写入 harness 审计，记忆收件箱和 Skill 草稿显示判断结果。
