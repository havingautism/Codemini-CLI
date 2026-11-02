# Codemini CLI

Codemini CLI 是一个本地优先的编码 agent（CLI + Web UI + 项目索引 + skills + memories + approvals）。本文件是它的领域词汇表：只收概念与命名，不收实现细节 —— 实现决策属于 `docs/adr/` 或 `.scratch/` 下的 spec。

## Language

### harness 决策层

在 Agent loop 外围提供受限、可回放的判断信号的运行时层。它只能输出预先定义的 choice、score 或 noul 结果，不能绕过工具参数校验、命令策略、审批或沙箱。

### decision event（决策事件）

一次 harness 判断的不可变记录，包含 episode、step、裁剪后的状态、provider、模式和 advisory 结果。决策事件属于运行轨迹，不是用户 transcript。

### belief（信念状态）

Harness 根据当前 episode 的机器证据维护的离散后验概率；它是 advisory 信号，不是事实证明，也不能替代确定性验证。

### hard guard（硬门禁）

由权限、风险、路径、审批、沙箱和验证结果构成的确定性边界。硬门禁拒绝或升级动作时，belief 和 provider 结果不能降低限制。

### calibration（校准）

把 provider 输出概率与带结果的历史样本进行离线对照，生成带数据集和模型版本标识的质量报告；校准不会自动授予执行权限。

### drift（漂移）

模型预测、标签率、延迟、成本或输入分布随时间或切片发生的变化，需要通过版本化样本重新 shadow 和评估。

### RetryBenefit（重试收益）

对“再试一次是否有较大机会解决问题”的概率判断。它要求有历史结果或明确证据支持，单纯出现错误不会自动触发重试。

### ambiguous sample（歧义样本）

无法从工具结果、测试结果、审批或后续状态确定真实结果的历史记录。歧义样本会被排除在离线校准之外，避免把猜测当成标签。

### goal 功能（目标驱动长任务）

**goalState**:
一个会话上的长任务状态：外层目标、验收标准、约束、迭代进度、预算与判定轨迹。
_Avoid_: 在**代码标识符 / 字段名**里用 "goal" 单指它（一律写 `goalState`）；用 "goal" 指代 `planState.goal` / `specState.goal`（那是计划 / 规格的目标文本）。"goal 功能" 这类**限定用法**（功能名、文档与票题）不受此限。

**objective**:
`goalState` 里的外层目标文本，来自 `/goal` 的三段式语法。
_Avoid_: goal（`goal` 在本仓库已被计划 / 规格的目标文本占用）

**机器证据（machine evidence）**:
验收员判定时依据的可核验外部事实：测试退出码、命令输出、工作区改动。与执行模型的自述相对。
_Avoid_: 报告、总结、汇报（那些都是模型自述，不算机器证据）

**验收员（gatekeeper）**:
在每一轮结束时，对照验收标准独立判定目标是否达成的模型。它与执行工作的模型不是同一个。
_Avoid_: reviewer、评审员（`reviewer` 在本仓库已被 `buildGoalRequirementPacket` 的角色占用，指代码评审代理）

**验收标准（success criteria）**:
判定目标是否达成所依据的可验证条件。拿不出可验证条件的目标，不构成一个 goal。
_Avoid_: 目标、需求；验收清单（那是从目标派生出来的产物，不是本体）

**轮次（iteration）**:
goal 循环中一次完整的 turn —— 一次执行、一份汇报、一次判定。

**预算（budget）**:
允许 goal 循环运行的上限。主闸门是轮次上限，墙钟上限可选且默认关闭。

**completed**:
目标已被验收员确认达成而停止。

**exhausted**:
目标尚未被确认达成、预算已用尽而停止。可恢复。

**paused**:
由人或系统主动中止而停止，进度保留。可恢复。

**failed**:
循环内部出错，或已判定目标明确不可达而停止。不可恢复。
_Avoid_: 拿 failed 表示"预算用尽"（那是 exhausted）

**unreachable**:
验收员给出的判定结论：有证据表明目标在当前约束下无法达成（例如约束与目标相矛盾）。它是落 `failed` 的唯一非错误来源。
_Avoid_: 把"暂时还没做到"说成 unreachable（那只是未达成）
