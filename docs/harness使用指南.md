# Harness 使用指南

这项功能会在 Codemini 每一步结束时，额外做一次小判断，例如：是否继续、是否重试、是否需要人工查看、任务是否可能完成。

它默认关闭。关闭时，Codemini 的原有行为不变。

## 开启前先知道

Harness 只提供建议，不会绕过下面这些安全检查：

- 命令和路径限制
- 用户审批
- 沙箱
- 测试和确定性验收

高风险操作仍然需要原有的审批流程。Harness 的判断出错时，Codemini 会使用保守策略，或要求人工处理。

设置页里的“建议模式”只记录判断，不改变工具、Skill、上下文或完成流程。只有明确选择“外部决策接管（高风险）”后，Jev/Laya 才会参与这些流程；服务失败时工具会进入复核，任务不会因为没有判断而自动放行或结束。

## 最安全的开启方式：只观察

先打开规则判断，但只让它记录结果，不改变实际执行：

```powershell
codemini config set harness.enabled true
codemini config set harness.provider rules
codemini config set harness.mode shadow
```

Phase 4 的灰度开关默认是 0%，所以还不会真正产生线上 harness 记录。要给一小部分会话开启观察，可以设置：

```powershell
codemini config set harness.rollout.enabled true
codemini config set harness.rollout.percentage 10
codemini config set harness.rollout.risk_tiers '["low"]'
```

这表示只让大约 10% 的低风险会话进入观察范围。相同的会话会稳定地落在同一个分组，不会每次随机变化。

要关闭观察：

```powershell
codemini config set harness.rollout.enabled false
codemini config set harness.rollout.percentage 0
```

## 使用 Jev 或 Laya

Rules 不需要网络。Jev 和 Laya 需要先配置服务地址。

### Jev

```powershell
codemini config set harness.providers.jev.enabled true
codemini config set harness.providers.jev.base_url 'https://openrouter.ai/api/alpha/decisions'
codemini config set harness.providers.jev.api_key '你的 API Key'
codemini config set harness.provider jev
```

Codemini 会按 OpenRouter Decisions API 的格式发送请求，默认模型是 `typesafe/jev-1.13`。不要在地址后面再加 `/decide`。

### Laya

```powershell
codemini config set harness.providers.laya.enabled true
codemini config set harness.providers.laya.base_url 'http://127.0.0.1:8765'
codemini config set harness.provider laya
```

如果服务没有响应、超时或返回格式不对，这一次判断会记录为“弃权/失败”。建议模式下不会影响任务；外部决策接管模式下会进入复核或请求人工处理，不会因为没有判断而自动放行。

可以同时打开 Jev 和 Laya 做对比：

```powershell
codemini config set harness.providers.jev.enabled true
codemini config set harness.providers.laya.enabled true
```

两边的结果会分别记录，不会把两个概率直接平均。

## 查看决策记录

查看某个 episode 的完整记录：

```powershell
codemini harness replay <episode-id>
```

查看最近的总体统计：

```powershell
codemini harness metrics --limit 100
```

统计包括：

- 记录了多少个 episode
- provider 出错次数
- abstain 次数
- `continue`、`retry_once`、`ask_user`、`escalate` 等建议的数量

Web UI 的 **Trajectory** 页面中，也会显示一个默认折叠的“Harness 决策轨迹（只读）”区域。它只展示记录，不会修改会话内容。

## 做离线校准

校准需要一个 JSONL 文件，每行是一条带真实结果的记录。例如：

```json
{"id":"case-1","provider":"rules","modelVersion":"rules-v1","questionSetHash":"q1","prediction":0.9,"label":true,"latencyMs":20,"costUsd":0.001}
{"id":"case-2","provider":"rules","modelVersion":"rules-v1","questionSetHash":"q1","prediction":0.2,"label":false,"latencyMs":18,"costUsd":0.001}
```

生成校准报告：

```powershell
codemini harness calibrate .\calibration.jsonl --out .\harness-calibration.json
```

生成漂移报告：

```powershell
codemini harness drift .\calibration.jsonl
```

这些命令只读文件并打印报告，不会修改配置，也不会自动启用任何 provider。

如果要直接使用 Codemini 已记录的历史 episode 生成样本，可以运行：

```powershell
codemini harness calibrate-history --limit 1000
# 也可以保存到文件
codemini harness calibrate-history --limit 1000 --out .\harness-calibration.json
```

这个命令只采用能从工具结果、测试结果、审批和后续状态确定标签的记录。无法确定结果的记录会标记为歧义并排除，不会被猜测成“成功”或“失败”。报告会给出带数据集哈希的校准版本号；同一批数据和参数会得到同一个版本号，便于冻结和复现。

报告会包含 Brier、log loss、ECE、风险覆盖率、错误率、abstain 率、延迟、成本，以及可用时的 PSI/KS 漂移指标。

校准报告还会输出每条贝叶斯边的完整二值 CPT。没有样本的父状态组合也会通过 Dirichlet 平滑保留，避免运行时遇到缺失表项。

要使用生成的先验和 CPT，把报告中的 `calibration` 和 `cpts` 放入配置文件的 `harness.belief.priors` 与 `harness.belief.cpts`。例如：

```json
{
  "harness": {
    "belief": {
      "priors": { "TaskComplete": { "true": 0.72 } },
      "cpts": {
        "TestPass->TaskComplete": {
          "table": {
            "TestPass=true": { "true": 0.92, "false": 0.08 },
            "TestPass=false": { "true": 0.12, "false": 0.88 }
          }
        }
      }
    }
  }
}
```

配置后重启 Web UI；运行时会优先使用这些表，缺少的边继续使用内置工程先验。

重试判断现在单独看“重试收益”：只有历史结果或明确状态证明重试有希望时，才允许 `retry_once`。一次普通错误本身不会自动等于“应该重试”。

## 推荐使用顺序

1. 保持 `harness.rollout.percentage=0`，先检查配置。
2. 只启用 Rules，使用 5% 到 10% 的低风险灰度观察。
3. 用 `harness replay` 和 `harness metrics` 查看结果。
4. 准备带真实结果的 JSONL，再运行 `calibrate` 和 `drift`。
5. 确认 provider 稳定、错误率和误判可接受后，再逐步提高灰度比例。

如果要完全恢复原有行为，只需关闭：

```powershell
codemini config set harness.enabled false
codemini config set harness.rollout.enabled false
codemini config set harness.rollout.percentage 0
```
