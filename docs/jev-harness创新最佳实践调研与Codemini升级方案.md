# Jev 在 AI Harness 中的创新最佳实践与 Codemini 升级方案

## 结论先说

当前 Codemini 主要把 Jev/Laya 用在“继续、重试、询问、升级、完成”这几个粗粒度判断上，利用率还不够高。

更适合 Codemini 的方案是：

> 让模型负责理解、规划、执行和总结；让 Jev 负责一组边界清楚的“下一步选择”；让 Codemini 的确定性策略负责最后放行、审批和记录。

Jev 不应该成为新的 Agent 大脑，也不应该直接执行工具。它最适合做一个低延迟、结构化、可解释的决策层。

## 调研得到的关键实践

### 1. 用 Choice、Score、Noul 分开表达不同问题

Jev 的核心不是生成文字，而是返回三类可直接被代码消费的结果：

- **Choice**：从明确候选项中选一个，例如选择工具、Skill、模型或下一条路径；
- **Score**：在有顺序的等级上打分，例如风险、复杂度、紧急程度；
- **Noul**：判断一个问题为真的概率，例如“是否需要人工复核”。

这比让一个大模型返回一段“请继续执行，因为……”更容易校验，也避免了从自然语言中猜动作。[Jev AI GitHub 说明](https://github.com/jev-ai)、[Jev AI Tools 类型说明](https://jevai.tools/)

### 2. 一次状态输入，提出多个聚焦问题

同一份任务状态可以同时询问：

- 当前应该走哪条任务路径；
- 哪个工具最适合；
- 是否需要人工复核；
- 风险属于哪个等级；
- 任务是否已经完成。

这些问题可以并行评估，避免为每个判断重复发送一份上下文。[Jev AI GitHub 说明](https://github.com/jev-ai)

### 3. 候选项必须是真实可用的候选项

工具路由不能把所有工具的静态列表直接交给 Jev。应该先由 Codemini 根据：

- 当前激活的工具和 Skill；
- 当前权限；
- 当前工作区；
- 当前阶段；
- 工具参数是否完整；
- 工具是否处于冷却状态；

生成本次真正允许选择的候选集，再让 Jev 选择。

Jev 的路由页面也强调：路由应在执行前决定目的地，候选项要清晰、互斥，并准备低置信度的默认路径。[Jev Routing](https://jev-ai.pro/use-cases/routing)

### 4. 把“选择”和“执行”严格分开

推荐的闭环是：

```text
Codemini 收集状态
        ↓
Jev 返回 Choice / Score / Noul
        ↓
Codemini 策略层检查权限、风险和审批
        ↓
模型或工具运行
        ↓
Codemini 记录 append-only receipt
```

Jev 的工具护栏接口明确指出：Jev 返回 allow、confirm、review 或 deny，但不执行工具。[Jev API 文档](https://www.jevai.org/docs)

### 5. 使用工具护栏，而不是只判断“下一步动作”

每次实际工具调用前，都可以增加一次轻量判断：

- 当前工具是否适合这个任务；
- 参数是否涉及敏感操作；
- 是否需要确认；
- 是否需要人工复核；
- 是否应该换一个工具。

这比只在每个 Agent step 开始时判断一次更有价值，因为它能直接看到真实的工具、参数、副作用和可逆性。[Jev API tool-guard](https://www.jevai.org/docs)

### 6. 把完成度单独作为一个决策点

“模型说完成了”不等于“任务真的完成了”。Jev 提供了专门的 completion 判断：把目标、已完成工作、验证结果和已知缺口分开输入，返回 complete、verify_more 或 incomplete。[Jev API completion](https://www.jevai.org/docs)

Codemini 应在最终总结前调用这个判断，并继续保留测试退出码、diff、审批和工作区状态等确定性门禁。

### 7. 上下文选择是 Jev 的高收益用法

长任务中，模型不应该每轮都看到全部工具结果。可以让 Jev 对上下文块做 Choice/Noul 判断：

- 哪些信息仍与当前目标相关；
- 哪些结果已经过时；
- 哪些验证证据必须保留；
- 哪些失败记录需要保留用于重试判断。

必需的系统指令、审批信息和安全约束必须由 Codemini 固定保留，不能交给 Jev 删除。[Jev AI Tools 上下文选择示例](https://jevai.tools/)

### 8. 用概率分布，不要只用一个置信度数字

路由结果应该保留：

- 每个候选项的概率；
- 选中项的概率；
- provider confidence；
- 是否存在竞争候选；
- 是否命中最低置信度门槛。

例如 `run_tests=0.46`、`inspect_files=0.43` 与 `run_tests=0.91` 的业务含义完全不同。低置信度时应进入澄清、人工复核或默认安全路径，而不是强行执行。[Jev AI Tools 概率说明](https://jevai.tools/)

### 9. 把策略写在 Codemini，而不是写死在模型回答里

Jev 只返回判断信号。以下内容应由 Codemini 配置和代码决定：

- 置信度阈值；
- 哪些工具需要审批；
- 哪些路径始终禁止；
- 重试上限；
- 高风险动作的人工门槛；
- 成本、延迟和质量的权重。

这样可以不重新请求模型就调整阈值，也能在 provider 更换后保持相同的业务策略。[Jev Routing](https://jev-ai.pro/use-cases/routing)

### 10. 用 shadow、回放和反事实评估持续改进

每次决策都应记录：

- 输入状态哈希；
- 候选集；
- 问题集版本；
- provider/model 版本；
- 全部概率；
- 最终选择；
- Codemini 是否覆盖了该选择；
- 实际工具结果；
- 如果选择另一个候选，是否可能更好。

除了统计“选对了多少”，还应做反事实回放：把同一状态交给候选工具 A、B 的历史结果进行比较，评估 Jev 选择是否降低失败、延迟和成本。

## Codemini 当前实现与目标差距

当前已经具备：

- provider-neutral 的 Jev/Laya 适配层；
- Choice/Score/Noul 固定问题集合；
- 贝叶斯信念和逐边 CPT 校准；
- 重试收益判断；
- 工具可靠性统计和降权提示；
- shadow、灰度、回放、离线校准；
- 外部决策接管高风险模式；
- 硬门禁、审批和沙箱保护。

还需要增强：

1. 真实工具候选集路由，而不是只把可靠性写入工具描述；
2. Skill、MCP、CLI 和子代理的统一候选协议；
3. 工具调用前的 `allow / confirm / review / deny` 护栏；
4. 独立的任务路径路由：快速执行、深度分析、拆分任务、阻塞澄清；
5. 独立的最终完成度复核；
6. 上下文块保留和淘汰判断；
7. provider 全部概率、候选集和策略覆盖的 UI 展示；
8. 基于真实结果的反事实评估。

## 推荐的 Codemini V2 架构

### 决策点一：任务路由

输入：任务要求、风险、上下文完整度、预算、工作区状态。

候选：

- `proceed_fast`
- `deep_review`
- `split_task`
- `ask_user`
- `block`

输出决定本轮采用哪条执行路径。

### 决策点二：Skill 路由

输入：任务目标、当前阶段、候选 Skill 的名称和短说明。

候选示例：

- `codebase-onboarding`
- `diagnosing-bugs`
- `testing`
- `code-review`
- `documentation`
- `none`

低置信度时不自动加载 Skill，而是让模型继续使用通用流程或询问用户。

### 决策点三：工具路由

输入：任务、当前阶段、候选工具、工具可靠性、权限、风险和副作用。

输出：

- `selected_tool`
- 每个候选工具的概率；
- `needs_review`；
- `fallback_tool`。

Codemini 先过滤不允许的候选，再让 Jev 选择，避免把不可用工具暴露给模型。

### 决策点四：工具护栏

每次工具调用前输入：工具名、动作摘要、参数摘要、副作用、可逆性、已有安全证据。

输出：

- `allow`
- `confirm`
- `review`
- `deny`

这一步必须独立于“工具路由”，防止“选中了工具”被误解为“允许执行工具”。

### 决策点五：上下文选择

对每个上下文块记录：来源、时间、关联任务、验证价值、敏感级别和大小。Jev 只决定相关性，Codemini 固定保留安全规则、审批状态和关键测试证据。

### 决策点六：完成度复核

在生成最终总结前，使用目标、已完成工作、验证结果和已知缺口进行独立判断。只有确定性验证和完成度复核都通过，才允许把任务标记为完成。

## 最高优先级的三个落地步骤

### P0：工具路由和工具护栏

这是收益最高的一步。它能直接减少工具选错、危险工具误用和重复失败。先覆盖 `run`、文件读写、测试、`skill`、MCP 和 `run_subagent`。

### P1：完成度复核和上下文选择

这一步能减少“过早结束”和“上下文越来越长导致判断变差”。

### P2：反事实回放和策略实验台

在 UI 中对同一个决策展示：Jev 选择、其他候选概率、实际结果、如果选择其他候选的历史结果，以及策略覆盖原因。

## 采用时必须保留的边界

- Jev/Laya 不直接执行工具；
- 概率不是授权，也不是安全证明；
- 高风险动作必须走 Codemini 硬门禁和人工审批；
- 候选集由 Codemini 先过滤；
- 没有 `unknown`、`none` 或人工复核路径的问题不能直接用于高风险决策；
- provider 超时、Schema 错误或不可用时必须回退；
- 所有路由都必须可回放和可解释。

## 参考资料

- [Jev AI GitHub](https://github.com/jev-ai)
- [Jev Routing & Decisions](https://jev-ai.pro/use-cases/routing)
- [Jev AI Tools](https://jevai.tools/)
- [Jev API 文档](https://www.jevai.org/docs)
- [JevRouter 工作方式](https://www.jevrouter.co/how-it-works)
