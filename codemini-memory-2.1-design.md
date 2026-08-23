# Codemini Memory 2.1 设计文档

> Status: Design RFC  
> Scope: Codemini CLI / WebUI / Agent Runtime  
> Default Retrieval: SQLite FTS5 + BM25  
> Embedding: Optional, not required  
> Persistence: Local-first, no external daemon required

---

## 1. 目标

Memory 2.1 的目标不是“保存更多历史”，而是让 Codemini 在长期使用中形成稳定、可检索、可验证、可淘汰的工程记忆。

系统需要同时解决四类问题：

1. **跨会话记忆**：记住用户偏好、项目约定、历史决策。
2. **任务相关召回**：不是把全部记忆塞进 Prompt，而是只召回当前任务真正相关的内容。
3. **工程经验学习**：从“失败 → 调整策略 → 成功 → 验证”的过程里提炼可复用经验。
4. **长期治理**：记忆需要去重、强化、过期检查、冲突处理和淘汰，不能无限堆积。

最终形成：

```text
User / Project / Tool Trace
          │
          ├───────────────┐
          │               │
          ↓               ↓
Conversation          Experience
Writeback             Learning
          │               │
          └───────┬───────┘
                  ↓
             Memory Inbox
                  ↓
              Memory Gate
                  ↓
           Canonical Memory
                  │
          ┌───────┴────────┐
          ↓                ↓
      Global Store     Project Store
          │                │
          └───────┬────────┘
                  ↓
              FTS5 Index
                  ↓
           BM25 + Metadata
                  ↓
            Memory Recall
                  ↓
             Agent Context
```

---

## 2. 设计原则

### 2.1 LLM 负责理解，IR 负责检索

LLM 用于：

- 判断内容是否值得记忆
- 提炼 Atomic Fact
- 判断 Scope / Family / Kind
- 识别冲突
- 生成稳定摘要和 semantic key
- 做 consolidation / staleness review

FTS5 / BM25 用于：

- 检索
- 过滤
- 排序
- Top-K 召回

默认不依赖 Embedding。

---

### 2.2 Canonical Memory 与 Retrieval Index 分离

Canonical Memory 是唯一真相源。

```text
Canonical Memory
      ↓
Derived Retrieval Index
```

FTS 索引损坏时必须允许：

```text
rebuild
```

而不是影响 Memory 本身。

---

### 2.3 Atomic Facts 优先

每条 Memory 尽量只表达一个稳定事实。

错误示例：

```text
这个项目用 pnpm，而且 Windows 下 sandbox 有问题，
测试命令是 npm test，用户也喜欢简洁回答。
```

正确拆分：

```text
项目 package manager 使用 pnpm。
Windows 下 sandbox backend 有特定兼容问题。
项目测试命令为 node --test。
用户偏好简洁回答。
```

这样更容易：

- 检索
- 更新
- 去重
- 冲突处理
- 生命周期管理

---

### 2.4 Raw Error 不是 Memory

以下内容不能直接进入 Durable Memory：

```text
command not found
permission denied
exit 127
timeout
ECONNRESET
```

只有形成：

```text
Failure
  ↓
Root Cause
  ↓
Alternative Strategy
  ↓
Success
  ↓
Verification
```

才允许生成 Coding Lesson。

---

### 2.5 Memory 不能成为 Agent 单点故障

任何 Memory 子系统失败都应该优雅降级：

```text
FTS fail
→ rebuild
→ substring fallback

Writeback fail
→ skip

Dream fail
→ retain inbox

Memory disabled
→ normal agent loop
```

---

## 3. Memory Taxonomy

Memory 使用三个正交维度：

```text
scope
family
kind
```

---

### 3.1 Scope

Scope 决定“在哪里生效”。

```text
user
global
project
```

#### user

长期用户偏好：

```text
偏好 pnpm
回复使用中文
不自动 commit
```

#### global

跨项目环境/工具经验：

```text
PowerShell 某命令行为
Windows 某工具兼容性
WSL 某类构建规则
```

#### project

当前 repo 专属信息：

```text
项目使用 pnpm workspace
backend 位于 packages/server
generated/ 不允许修改
```

---

### 3.2 Family

Family 决定“属于哪类知识”。

```text
personal
repo
coding
procedure
```

#### personal

用户长期偏好和交互习惯。

#### repo

仓库约定、架构决策、模块职责、不可直接从代码低成本恢复的信息。

#### coding

失败经验、已验证 workaround、坑点、修复经验。

#### procedure

任务流程、验证步骤、局部 SOP。

---

### 3.3 Kind

Kind 描述知识性质：

```text
preference
convention
lesson
note
```

典型映射：

| Scope | Family | Kind | 示例 |
|---|---|---|---|
| user | personal | preference | 用户偏好 pnpm |
| project | repo | convention | 项目统一使用 Vitest |
| project | coding | lesson | 某命令在该 repo 中不可用 |
| project | procedure | convention | 修改 provider 后必须跑 provider tests |
| global | coding | lesson | PowerShell 下某工具需要不同参数 |
| project | repo | note | 某模块已废弃但仍保留兼容入口 |

---

## 4. Memory Record

建议统一为：

```ts
interface MemoryRecord {
  id: string;

  scope: "user" | "global" | "project";
  family: "personal" | "repo" | "coding" | "procedure";
  kind: "preference" | "convention" | "lesson" | "note";

  semanticKey?: string;

  content: string;
  summary: string;

  lifecycle: "operational" | "longterm" | "archived";

  confidence: number;

  source?: string;
  sourceSessionId?: string;
  sourceBranchId?: string;

  toolName?: string;
  environmentKey?: string;
  agentRole?: string;

  expectedValidDays?: number;

  confirmationCount: number;
  accessCount: number;

  successCount: number;
  failureCount: number;

  lastConfirmedAt?: string;
  lastAccessedAt?: string;

  evidence?: Record<string, unknown>;
  tags?: string[];

  pinned: boolean;
  revision: number;

  createdAt: string;
  updatedAt: string;
}
```

---

## 5. Canonical Storage

Codemini 保持 local-first。

### 5.1 Global Store

存放：

```text
user
global
```

数据库：

```text
codemini.sqlite
```

---

### 5.2 Project Store

存放：

```text
project
```

数据库：

```text
<repo>/.codemini/index.sqlite
```

Project Memory 跟 repository 一起存在，不依赖全局绝对路径映射。

---

### 5.3 Schema

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,

  scope TEXT NOT NULL,
  family TEXT NOT NULL,
  kind TEXT NOT NULL,

  semantic_key TEXT NOT NULL DEFAULT '',

  content TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',

  lifecycle TEXT NOT NULL DEFAULT 'operational',
  confidence REAL NOT NULL DEFAULT 0.8,

  source TEXT NOT NULL DEFAULT '',
  source_session_id TEXT NOT NULL DEFAULT '',
  source_branch_id TEXT NOT NULL DEFAULT '',

  tool_name TEXT NOT NULL DEFAULT '',
  environment_key TEXT NOT NULL DEFAULT '',
  agent_role TEXT NOT NULL DEFAULT '*',

  expected_valid_days INTEGER,

  confirmation_count INTEGER NOT NULL DEFAULT 0,
  access_count INTEGER NOT NULL DEFAULT 0,

  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,

  last_confirmed_at TEXT,
  last_accessed_at TEXT,

  evidence_json TEXT NOT NULL DEFAULT '{}',
  tags_json TEXT NOT NULL DEFAULT '[]',

  pinned INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
```

建议索引：

```sql
CREATE INDEX memories_scope_idx
ON memories(scope, updated_at DESC);

CREATE INDEX memories_family_idx
ON memories(family, kind);

CREATE INDEX memories_semantic_key_idx
ON memories(semantic_key);

CREATE INDEX memories_tool_idx
ON memories(tool_name, environment_key);

CREATE INDEX memories_lifecycle_idx
ON memories(lifecycle, updated_at DESC);
```

---

## 6. Retrieval Index

FTS5 是默认检索层。

```sql
CREATE VIRTUAL TABLE memory_fts USING fts5(
  memory_id UNINDEXED,

  search_text,

  raw_content UNINDEXED,

  scope UNINDEXED,
  family UNINDEXED,
  kind UNINDEXED,

  tool_name UNINDEXED,
  environment_key UNINDEXED,

  tokenize='unicode61'
);
```

`memory_fts` 只保存可重建 derived data。

---

## 7. 中文检索

默认通过 Node 原生能力进行预分词：

```ts
const segmenter = new Intl.Segmenter("zh", {
  granularity: "word"
});
```

例如：

```text
Windows下pnpm安装依赖失败
```

转换成：

```text
Windows 下 pnpm 安装 依赖 失败
```

写入 `search_text`。

Canonical `content` 永远保留原文。

如果分词不可用：

```text
unicode61
+
substring fallback
```

---

## 8. Memory Retrieval Adapter

统一接口：

```ts
interface MemoryRetrievalAdapter {
  search(
    query: string,
    options: MemorySearchOptions
  ): Promise<MemoryHit[]>;

  upsert(memory: MemoryRecord): Promise<void>;

  remove(id: string): Promise<void>;

  rebuild(options?: {
    scope?: string;
  }): Promise<void>;
}
```

默认实现：

```text
FTS5RetrievalAdapter
```

未来可以扩展：

```text
HybridRetrievalAdapter
```

但 Memory 2.1 默认不启用 Embedding。

---

## 9. Retrieval Query

Memory query 不直接等于用户原文。

建议组合：

```text
user task
+
project context
+
OS
+
shell
+
tool
+
recent error
```

例如：

```text
User:
修 Windows 下 microsandbox 启动问题

Query:
windows microsandbox startup sandbox powershell
```

---

## 10. Retrieval Ranking

第一版保持简单。

```text
retrieval_score =

BM25 relevance      70%
confidence           15%
verification         10%
recency               5%
```

Project exact scope 优先作为 filter，而不是普通软权重。

---

### 10.1 Verification Boost

以下 Memory 提高排序：

```text
confirmation_count > 0
success_count > 0
verified evidence
```

---

### 10.2 Retrieval 与 Retention 分离

Retrieval Score 回答：

> 当前任务需要它吗？

Retention Score 回答：

> 这条记忆还值得长期保存吗？

不要混为一个分数。

---

## 11. Recall Architecture

Memory 2.1 有三种召回。

---

### 11.1 Bootstrap Recall

Session 创建时注入少量稳定信息：

```text
User Profile
Global Environment
Pinned Project Rules
```

例如：

```xml
<memory_profile>
User:
- prefers pnpm
- prefers Chinese responses

Environment:
- Windows / PowerShell

Project:
- do not modify generated files
</memory_profile>
```

Bootstrap 必须：

```text
small
stable
cache-friendly
```

不加载大量 Coding Lessons。

---

### 11.2 Turn Recall

每个用户 coding turn：

```text
Task
  ↓
MemoryRetriever
  ↓
repo / coding / procedure
  ↓
Top 3~5
```

注入：

```xml
<retrieved_memory>
[coding]
...

[repo]
...

[procedure]
...
</retrieved_memory>
```

---

### 11.3 Failure Recall

Tool 执行失败后才触发专门的 Coding Memory 检索。

```text
Tool Failure
    ↓
buildFailureQuery()
    ↓
family=coding
    ↓
Top 1~3
    ↓
Next LLM Turn
```

例如：

```text
tool=Bash
command=pnpm exec tsx
error=command not found
environment=linux/bash
```

召回：

```xml
<recovery_memory>
- This repository does not install tsx...
</recovery_memory>
```

不建议每个 Tool Call 前都做一次 retrieval。

---

## 12. Prompt Layout

Memory 永远放在稳定 system prefix 后面。

```text
Stable System Prefix
│
├─ Soul
├─ Environment
├─ Project Instructions
├─ Skills
├─ Tool Rules
└─ Reply Language

Volatile Tail
│
├─ Memory Profile
├─ Guaranteed Memory
├─ Retrieved Memory
└─ Recovery Memory
```

这样最大限度保持 Prompt Cache 稳定。

---

## 13. Guaranteed Memory

部分记忆不能依赖检索命中。

典型：

```text
pinned
user correction
critical project rule
safety constraint
```

例如：

```text
不要自动 git commit。
```

即使当前 query 与 Git 不相关，也应该保留。

Context：

```text
Guaranteed Memory
+
Retrieved Memory
```

---

## 14. Memory Profile

Profile 是 Atomic Facts 的 compact materialized view。

不是另一份独立事实库。

例如：

```text
User Profile
- prefers pnpm
- prefers concise Chinese responses

Project Profile
- package manager: pnpm
- tests: node --test
- generated files must not be edited
```

Profile 来源：

```text
Atomic Memory
    ↓
Profile Builder
    ↓
Compact Profile
```

避免 Profile 与 Atomic Facts 发生数据漂移。

---

## 15. Conversation Writeback Pipeline

Conversation Memory 主要处理：

```text
personal
repo
procedure
stable conventions
decisions
```

流程：

```text
User Message
+
Final Assistant Response
        ↓
Session Review
        ↓
LLM Extraction
        ↓
Memory Candidate
        ↓
Inbox
        ↓
Memory Gate
```

---

### 15.1 Session Review 输出

```json
{
  "scope": "project",
  "family": "repo",
  "kind": "convention",

  "content": "项目依赖统一使用 pnpm 管理。",
  "summary": "项目使用 pnpm",

  "semantic_key": "project.package-manager",

  "confidence": 0.9,

  "decision_state": "verified",
  "durable_score": 8
}
```

---

### 15.2 不应保存的内容

```text
当前 task 临时约束
Brainstorming
未经确认的假设
可以随时从代码重新读取的普通事实
临时错误
Assistant 自己推测的决策
```

---

## 16. Experience Learning Pipeline

这是 Memory 2.1 最重要的 Coding Agent 能力。

输入不是聊天文本，而是：

```text
Structured Tool Trace
```

例如：

```text
run A ❌
read package.json ✅
run B ✅
test ✅
```

目标是学习：

```text
Failed Approach
Root Cause
Verified Recovery
Regression Rule
```

---

## 17. Experience Tracker

新增：

```text
memory-experience-tracker.js
```

模型：

```ts
interface ExperienceEpisode {
  id: string;

  sessionId: string;
  branchId?: string;

  taskSummary: string;

  toolFamily?: string;
  environmentKey: string;

  attempts: ExperienceAttempt[];

  state:
    | "open"
    | "failed"
    | "recovering"
    | "recovered"
    | "verified"
    | "discarded";
}
```

Attempt：

```ts
interface ExperienceAttempt {
  tool: string;

  inputFingerprint: string;
  inputSummary?: string;

  outcome:
    | "success"
    | "failure"
    | "blocked";

  errorClass?: string;

  timestamp: string;
}
```

---

## 18. Experience Episode 状态机

```text
OPEN
 │
 │ tool failure
 ↓
FAILED
 │
 │ strategy changed
 ↓
RECOVERING
 │
 │ later success
 ↓
RECOVERED
 │
 │ deterministic verification
 ↓
VERIFIED
 │
 ↓
Experience Extractor
```

如果 Session 结束仍未恢复：

```text
FAILED
↓
DISCARDED
```

不生成 Durable Coding Memory。

---

## 19. Recovery Detection

必须区分：

```text
same retry
```

和：

```text
strategy change
```

例如：

```text
pnpm exec tsx foo.ts ❌
pnpm exec tsx foo.ts ❌
```

不是学习。

而：

```text
pnpm exec tsx foo.ts ❌
read package.json
node foo.js ✅
```

才是 recovery candidate。

---

## 20. Verification

尽量使用 deterministic signal。

允许：

```text
test exit=0
build exit=0
lint exit=0
read-back confirms state
expected file exists
user explicit confirmation
same solution later succeeds again
```

不允许仅凭：

```text
Assistant:
"问题已解决"
```

就认为 Verified。

---

## 21. Coding Lesson

Verified Episode 才生成：

```json
{
  "scope": "project",
  "family": "coding",
  "kind": "lesson",

  "summary": "该项目不能直接使用 pnpm exec tsx",

  "content": "该项目未安装 tsx。直接执行 `pnpm exec tsx` 会失败；已验证应使用项目已有 Node 入口执行。",

  "tool_name": "Bash",
  "environment_key": "linux:bash",

  "confidence": 0.88,

  "evidence": {
    "failed_attempts": 1,
    "successful_recovery": true,
    "verified": true
  }
}
```

---

## 22. Error Classification

建议对常见 Tool Failure 做 deterministic classification。

例如：

```text
command_not_found
permission_denied
file_not_found
invalid_arguments
dependency_missing
build_failure
test_failure
network_failure
timeout
policy_blocked
workspace_escape
unknown
```

分类用于：

```text
Experience Correlation
Failure Recall
Metrics
Dedup
```

而不是直接作为 Memory。

---

## 23. Reinforcement

每条 Memory 支持：

```text
confirmation_count
last_confirmed_at

access_count
last_accessed_at

success_count
failure_count
```

---

### 23.1 Access

只有实际 Retrieval 返回的 Memory 才记：

```text
access_count += 1
last_accessed_at = now
```

Bootstrap 自动注入不算 Retrieval Hit。

---

### 23.2 Confirmation

以下情况可以确认：

```text
Memory 被召回
+
Agent 使用了对应策略
+
Deterministic verification 成功
```

结果：

```text
confirmation_count += 1
success_count += 1
last_confirmed_at = now
```

---

### 23.3 Negative Evidence

如果被召回的 Memory 被证明无效：

```text
failure_count += 1
```

超过阈值进入：

```text
re-evaluation
```

而不是立即删除。

---

## 24. Retention Score

建议：

```text
retention_score =

confidence                0.65
+
confirmation_freshness    0.25
+
access_heat               0.10
```

用于：

```text
eviction
maintenance priority
longterm promotion
```

不直接代替 Retrieval Score。

---

## 25. Lifecycle

Memory Lifecycle：

```text
operational
longterm
archived
```

---

### 25.1 Operational

新 Memory 默认进入：

```text
operational
```

---

### 25.2 Longterm

典型条件：

```text
confirmation_count >= 3

or

pinned

or

explicit durable preference
```

再由 Dream 判断是否提升为：

```text
longterm
```

---

### 25.3 Archived

以下情况进入 Archive：

```text
stale
contradicted
duplicate
superseded
low utility
invalidated
noise
```

---

## 26. expected_valid_days

Memory 可以带：

```text
expected_valid_days
```

例如：

| Memory | 建议有效期 |
|---|---:|
| 用户长期偏好 | 365 |
| 项目架构 convention | 180 |
| 环境 workaround | 90 |
| dependency version bug | 30 |
| 临时兼容策略 | 14 |

到期不自动删除。

只是进入：

```text
Staleness Review
```

---

## 27. Staleness Review

流程：

```text
expected validity reached
        ↓
Stale Candidate
        ↓
Dream
        ↓
KEEP / REMOVE / EXTEND
```

EXTEND 允许：

```text
expected_valid_days
```

向后延长。

---

## 28. Consolidation

当同类 Memory 过多：

```text
lesson A
lesson B
lesson C
```

Dream 可以合并：

```text
Consolidated Lesson
```

要求：

- 不合并无关事实
- 保留精确命令
- 保留关键路径
- 保留 evidence
- 保留 semantic key
- archive source memories

---

## 29. Contradiction

对于相同 semantic key：

```text
project.package-manager = npm
```

后来：

```text
project.package-manager = pnpm
```

不要简单 append。

流程：

```text
new candidate
   ↓
semantic key collision
   ↓
compare evidence / recency
   ↓
update existing
or
archive old + create new
```

---

## 30. Dream

Dream 在 Memory 2.1 中定义为：

> Memory Lifecycle Manager

职责：

```text
Promotion
Deduplication
Contradiction
Consolidation
Staleness
Reinforcement
Archival
Profile Refresh
```

不是实时检索组件。

---

## 31. Dream 输入

一次 Maintenance 请求可以同时携带：

```text
Inbox Candidates
Stale Facts
Consolidation Candidates
Contradiction Candidates
Low-utility Candidates
```

避免为每一种维护动作独立调用一次 LLM。

---

## 32. Dream 输出

示例：

```json
{
  "promotions": [
    {
      "candidate_id": "...",
      "action": "keep"
    }
  ],

  "staleness": [
    {
      "memory_id": "...",
      "action": "extend",
      "extend_days": 90
    }
  ],

  "consolidations": [
    {
      "source_ids": ["...", "..."],
      "result": {
        "summary": "...",
        "content": "..."
      }
    }
  ],

  "archives": [
    {
      "memory_id": "...",
      "reason": "superseded"
    }
  ]
}
```

---

## 33. save_memory

继续提供显式 Tool。

用途：

```text
用户明确要求记住
稳定偏好
明确项目规则
明确长期约束
```

例如：

```text
以后这个项目不要自动 commit。
```

立即写入，不必等待 Dream。

---

## 34. search_memory

建议升级接口：

```ts
search_memory({
  query,

  scope?: "user" | "global" | "project" | "all",

  family?: [
    "personal",
    "repo",
    "coding",
    "procedure"
  ],

  kind?: [
    "preference",
    "convention",
    "lesson",
    "note"
  ],

  limit?: number
})
```

统一走：

```text
MemoryRetriever
```

---

## 35. list_memory

支持：

```text
scope
family
kind
lifecycle
project
```

过滤。

---

## 36. forget_memory

删除 canonical memory。

FTS 删除失败不能阻止 canonical 删除。

---

## 37. Memory Index Recovery

实现：

```ts
rebuildMemoryIndex()
```

触发：

```text
first use
schema change
explicit maintenance
index corruption
dirty marker
```

查询失败：

```text
FTS
 ↓
error
 ↓
rebuild once
 ↓
retry
 ↓
substring fallback
```

---

## 38. Fallback Search

Fallback 不追求高级相关性。

仅作为：

```text
Memory Availability Safety Net
```

实现：

```text
summary.includes(query)
content.includes(query)
tag.includes(query)
```

---

## 39. Concurrency

Memory 可能同时被：

```text
Lead Agent
Subagent
Fork Task
Session Review
Dream
Manual Tool
```

操作。

因此使用：

```text
revision
```

实现 optimistic concurrency。

```sql
UPDATE memories
SET
  content = ?,
  revision = revision + 1,
  updated_at = ?
WHERE id = ?
AND revision = ?;
```

`changes = 0`：

```text
stale write
```

重新加载最新版本后再判断。

---

## 40. Fork Task Memory

Fork Task 应继承：

```text
同一份 Parent Memory Snapshot
```

而不是每个 branch 独立重新读取动态 Memory。

目的：

```text
consistent state
deterministic behavior
prompt cache friendly
```

---

## 41. Fork 写入策略

Fork branch：

```text
Persistent Memory Read ✅
Durable Direct Write ❌
Memory Candidate Write ✅
```

例如：

```text
Fork A → Candidate A
Fork B → Candidate B
Fork C → Candidate C
```

Parent Join：

```text
Candidates
   ↓
dedupe
   ↓
evidence merge
   ↓
Memory Gate
   ↓
Persistent Commit
```

---

## 42. Subagent Memory

Subagent 可以：

```text
读取共享 User / Global / Project Memory
```

但建议 Memory Candidate 带：

```text
source_branch_id
agent_role
```

便于：

```text
traceability
confidence evaluation
role-specific retrieval
```

---

## 43. Agent Role

不新增 agent scope。

只作为 metadata：

```text
agent_role = "*"
reviewer
tester
coder
```

例如：

```text
scope=project
family=procedure
agent_role=reviewer
```

表示 Reviewer 场景优先。

---

## 44. Memory Budget

建议使用 token-aware budget。

```json
{
  "memory": {
    "bootstrap": {
      "max_tokens": 600
    },

    "retrieval": {
      "max_tokens": 1000
    },

    "recovery": {
      "max_tokens": 500
    }
  }
}
```

Memory 不应该挤压主任务 context。

---

## 45. Configuration

建议：

```json
{
  "memory": {
    "enabled": true,

    "bootstrap": {
      "enabled": true,
      "max_tokens": 600
    },

    "retrieval": {
      "enabled": true,
      "adapter": "fts5",
      "turn_top_k": 5,
      "failure_top_k": 3,
      "max_tokens": 1000
    },

    "experience": {
      "enabled": true,
      "capture_tool_trace": true,
      "require_recovery": true,
      "require_verification": true,
      "max_attempts_per_episode": 6
    },

    "writeback": {
      "enabled": true,
      "idle_delay_ms": 1500
    },

    "lifecycle": {
      "enabled": true,
      "staleness_review": true,
      "consolidation": true
    },

    "index": {
      "rebuild_on_corruption": true,
      "substring_fallback": true
    }
  }
}
```

---

## 46. Embedding

Memory 2.1 默认：

```text
No Embedding
No Vector DB
No External Memory Server
```

未来保留：

```ts
MemoryRetrievalAdapter
```

扩展能力即可。

例如：

```text
FTS5RetrievalAdapter
HybridRetrievalAdapter
RemoteMemoryAdapter
```

但不进入默认依赖。

---

## 47. Module Structure

推荐：

```text
src/core/

memory-store.js
memory-policy.js
memory-prompt.js
memory-session-review.js

memory-sqlite-store.js
memory-retriever.js
memory-ranker.js

memory-retrieval-adapter.js
memory-retrieval-fts5.js
memory-retrieval-fallback.js

memory-experience-tracker.js
memory-experience-extractor.js

memory-reinforcement.js
memory-lifecycle.js

dream-evaluator.js
dream-consolidate.js
```

不要为了目录美观一次性做大规模文件移动。

---

## 48. MemoryStore Facade

上层统一只依赖：

```ts
interface MemoryStore {
  add(memory: MemoryRecord): Promise<MemoryRecord>;

  update(
    id: string,
    patch: Partial<MemoryRecord>,
    expectedRevision?: number
  ): Promise<MemoryRecord>;

  remove(id: string): Promise<void>;

  get(id: string): Promise<MemoryRecord | null>;

  list(options: MemoryListOptions): Promise<MemoryRecord[]>;

  search(
    query: string,
    options: MemorySearchOptions
  ): Promise<MemoryHit[]>;
}
```

避免：

```text
Agent Loop
直接操作 SQLite
```

---

## 49. Observability

建议产生：

```text
memory:candidate
memory:promoted
memory:retrieved
memory:confirmed
memory:invalidated
memory:archived
memory:index_rebuilt

memory:experience_opened
memory:experience_recovered
memory:experience_verified
memory:lesson_generated
```

---

## 50. Trajectory Integration

Memory event 可以进入 Codemini Trajectory。

例如：

```text
Memory recalled

Reason:
Bash + Windows + pnpm matched
a verified project coding lesson
```

用户可以理解：

```text
为什么 Agent 这次没有再踩旧坑。
```

---

## 51. Metrics

建议：

```text
memory_total

retrieval_hits
retrieval_misses

fts_fallback_count
index_rebuild_count

candidate_count
promotion_count
archive_count

experience_episode_count
experience_recovery_count
experience_verified_count

lesson_generated_count
lesson_reused_count

confirmation_count
invalidated_memory_count
```

---

## 52. WebUI

Memory Dialog 建议继续按 Scope 展示：

```text
User
Project
Global
```

增加 Family Filter：

```text
All
Personal
Repo
Coding
Procedure
```

---

## 53. Memory Detail

显示：

```text
Summary
Content

Scope
Family
Kind
Lifecycle

Confidence
Confirmation Count
Retrieval Hits

Created
Updated
Last Confirmed
Last Recalled

Expected Validity

Source Session
Tool
Environment
Agent Role
```

---

## 54. Coding Memory UI

Coding Lesson 可以使用专门结构：

```text
Problem

Failed Approach

Verified Recovery

Verification

Applicable Environment
```

如果 evidence 中存在对应数据。

---

## 55. Procedure Memory UI

Procedure Memory 可展示：

```text
Trigger

Steps

Validation

Known Exceptions
```

未来如果成熟，可以允许：

```text
Promote to Skill
```

但 Memory 2.1 不自动把 Procedure 变成 Skill。

---

## 56. Security

Memory 写入必须继续过滤：

```text
API Keys
Passwords
Tokens
Private Keys
Authorization headers
Secrets
Credentials
```

对于 Tool Trace：

```text
args
stdout
stderr
```

必须先 sanitize，再交给 Memory Extractor。

---

## 57. Evidence

Coding Memory 应尽量保存 provenance。

例如：

```json
{
  "sessionId": "...",
  "branchId": "...",

  "failedAttempts": [
    {
      "tool": "Bash",
      "errorClass": "command_not_found"
    }
  ],

  "successfulAttempt": {
    "tool": "Bash"
  },

  "verification": {
    "type": "test_exit_zero"
  }
}
```

Memory content 不需要塞完整原始日志。

---

## 58. Dedup

优先使用：

```text
semantic_key
```

没有 semantic key 时：

```text
summary normalized
+
scope
+
family
+
kind
```

作为候选 dedup。

真正 near-duplicate merge 交给 Dream。

---

## 59. Semantic Key

典型：

```text
user.package-manager-preference
project.package-manager
project.test-framework
project.generated-files-policy

coding.windows.microsandbox.compat
coding.node-pty.build.windows

procedure.provider-change-validation
```

Semantic key 应稳定，不包含：

```text
session id
timestamp
random hash
```

---

## 60. Memory Query Expansion

无需 Embedding，也可以让当前 Chat LLM 做轻量 Query Expansion。

例如：

```text
User:
怎么跑单测？
```

扩展：

```text
test unit-test vitest jest npm pnpm test
```

流程：

```text
User Task
  ↓
cheap deterministic keywords
  ↓
optional LLM expansion
  ↓
FTS
```

默认不要为每次检索额外强制发 LLM 请求。

优先从：

```text
current task
project metadata
tool/error
```

构造 query。

---

## 61. Retention Capacity

Memory 不能无限增长。

建议：

```text
user       100~300
global     300~1000
project    500~3000
```

不硬编码死值，作为默认 cap。

超过容量：

```text
Retention Score
   ↓
protected/pinned
   ↓
archive lowest utility
```

不是直接删除。

---

## 62. Guaranteed Categories

建议：

```text
pinned
user_correction
critical_project_rule
security_constraint
```

始终有独立 Prompt Budget。

---

## 63. Failure Recall Guard

不是所有 Tool Failure 都查 Memory。

以下可以 skip：

```text
user cancelled
policy blocked
network transient
rate limit
obvious malformed args
```

优先：

```text
command failure
build failure
test failure
dependency mismatch
environment-specific failure
repeatable tool usage failure
```

---

## 64. Experience Correlation

Tracker 应按：

```text
session
task
tool family
target files
error class
```

关联 attempts。

避免把完全不同的问题串成一个 Episode。

---

## 65. Experience TTL

未完成 Episode 只属于 session-local working state。

```text
session end
+
not recovered
→ discard
```

不需要长期保存全部失败轨迹。

---

## 66. Memory Injection Snapshot

同一 Turn 内：

```text
Memory Retrieval
    ↓
freeze snapshot
    ↓
Agent / Forks
```

不要在一次 parallel execution 中途每个 branch 看到不同 Memory 版本。

---

## 67. Writeback Timing

建议：

```text
Immediate:
explicit save_memory

After Turn:
Conversation Candidate
Experience State Update

After Recovery:
Experience Candidate

Background:
Session Review

Maintenance:
Dream
```

---

## 68. Memory Gate

所有自动候选进入 Durable Memory 前经过统一 Gate：

```text
Candidate
   ↓
Secret Filter
   ↓
Durability
   ↓
Scope
   ↓
Evidence
   ↓
Dedup / Conflict
   ↓
Promote
```

---

## 69. Candidate Schema

```ts
interface MemoryCandidate {
  id: string;

  scope: MemoryScope;
  family: MemoryFamily;
  kind: MemoryKind;

  content: string;
  summary: string;

  semanticKey?: string;

  confidence: number;
  durableScore?: number;

  source: string;

  evidence?: Record<string, unknown>;

  suggestedLifecycle?: "operational" | "longterm";
}
```

---

## 70. Testing Strategy

至少增加：

```text
memory-sqlite-store.test.js
memory-fts5.test.js
memory-retrieval.test.js

memory-experience-tracker.test.js
memory-experience-extractor.test.js

memory-reinforcement.test.js
memory-lifecycle.test.js

memory-fork-snapshot.test.js
memory-index-rebuild.test.js
```

---

## 71. 核心测试场景

### Scenario A：跨会话召回

Session A：

```text
项目依赖统一使用 pnpm。
```

Session B：

```text
安装新 dependency。
```

要求：

```text
Project Memory 被召回。
```

---

### Scenario B：Project Isolation

Project A：

```text
测试框架 Vitest
```

Project B：

```text
不能召回该规则
```

---

### Scenario C：Global Coding Lesson

Global：

```text
PowerShell 某工具兼容策略
```

不同 repo：

```text
允许召回
```

---

### Scenario D：Tool Learning

第一次：

```text
run A ❌
run B ✅
test ✅
```

生成：

```text
Verified Coding Lesson
```

下一 Session 同类任务：

```text
召回 Lesson
避免再次优先走 A
```

---

### Scenario E：Raw Error

只有：

```text
command not found
```

没有 recovery：

```text
不生成 Durable Memory
```

---

### Scenario F：Index Corruption

破坏：

```text
memory_fts
```

要求：

```text
Canonical Memory 不受影响

rebuild

或 substring fallback
```

---

### Scenario G：Staleness

Memory：

```text
expected_valid_days = 30
```

超期：

```text
进入 Staleness Review
```

不直接删除。

---

### Scenario H：Fork

Parent：

```text
Memory Snapshot M1
```

Fork A/B/C：

```text
全部读取 M1

产生 candidate
不直接 durable write
```

Parent Join：

```text
统一 merge
```

---

## 72. Eval 指标

Memory eval 不应只看：

```text
Recall accuracy
```

还要看：

```text
Task success rate

Repeated failure rate

Tool retry count

Memory precision

Memory pollution rate

Cross-project leakage

Prompt token overhead

Latency overhead

Lesson reuse rate
```

---

## 73. Acceptance Criteria

### Storage

```text
✓ Canonical Memory 独立于 FTS Index
✓ User / Global / Project 隔离
✓ Revision 支持并发更新
```

### Retrieval

```text
✓ FTS5/BM25
✓ 中文检索
✓ Top-K relevant recall
✓ Index rebuild
✓ Fallback search
✓ 无 Embedding 依赖
```

### Context

```text
✓ Bootstrap Profile
✓ Guaranteed Memory
✓ Turn Recall
✓ Failure Recall
✓ Memory 位于 Prompt volatile tail
```

### Experience

```text
✓ Raw Error 不入长期 Memory
✓ Failure → Recovery 可形成 Episode
✓ Deterministic Verification
✓ Verified Coding Lesson
✓ 后续 Session 可召回
```

### Lifecycle

```text
✓ Confidence
✓ Confirmation
✓ Access Heat
✓ Staleness
✓ Consolidation
✓ Archive
```

### Parallel

```text
✓ Fork 使用统一 Snapshot
✓ Branch 不直接持久化自动 Memory
✓ Candidate 在 Parent Join 后统一提交
✓ Revision Conflict 可处理
```

---

## 74. 实现优先级

建议依次实现：

```text
P0
Canonical Memory
FTS5
Relevant Recall

P1
Experience Tracker
Failure Recall
Verified Coding Lessons

P2
Confirmation
Access Heat
Staleness
Consolidation

P3
Fork-safe Memory
UI Observability
Advanced Eval
```

---

## 75. 最终架构

```text
                           Codemini
                              │
                 ┌────────────┴────────────┐
                 │                         │
           Conversation                Tool Trace
                 │                         │
                 ↓                         ↓
          Session Review           Experience Tracker
                 │                         │
                 │                  Failure → Recovery
                 │                         │
                 │                   Verification
                 │                         │
                 └────────────┬────────────┘
                              ↓
                       Memory Candidate
                              ↓
                         Memory Gate
                              ↓
                       Atomic Memories
                              │
               ┌──────────────┴───────────────┐
               ↓                              ↓
          Global SQLite                  Project SQLite
               │                              │
               └──────────────┬───────────────┘
                              ↓
                     Derived FTS5 Index
                              ↓
                    BM25 + Metadata Rank
                              ↓
                        Memory Retriever
                              │
           ┌──────────────────┼─────────────────┐
           ↓                  ↓                 ↓
      Bootstrap           Turn Recall      Failure Recall
           │                  │                 │
           └──────────────────┼─────────────────┘
                              ↓
                         Agent Context
                              ↓
                           Behavior
                              │
                ┌─────────────┴─────────────┐
                ↓                           ↓
             Success                    Contradiction
                ↓                           ↓
          Reinforcement                  Re-evaluate
                │                           │
                └─────────────┬─────────────┘
                              ↓
                            Dream
                              │
                  ┌───────────┼───────────┐
                  ↓           ↓           ↓
               Merge        Stale       Archive
                  │           │           │
                  └───────────┴───────────┘
                              ↓
                         Updated Memory
```

---

## 76. 定位

Memory 2.1 的重点不是：

> “Codemini 有长期记忆。”

而是：

> **Codemini 会在正确的任务里想起正确的事情，并记住自己曾经如何成功解决过这个代码库的问题。**

对应四种长期价值：

```text
Personal Memory
Repository Memory
Procedure Memory
Verified Coding Experience
```

默认：

```text
Local SQLite
+
FTS5/BM25
+
LLM Extraction
+
No Embedding Required
```

这使 Memory 2.1 仍然符合 Codemini 的核心方向：

```text
local-first
lightweight
cache-friendly
offline-friendly
controllable
coding-oriented
```

---

## 77. 当前实现进度与遗留问题

> 本节是暂存区代码相对本设计文档的实现核对与补齐记录。上一轮核对发现的缺口已大部分补齐（P0/P1 完成，P2 部分完成），剩余项为 P2/P3 的未来项，逐条标注。

### 77.1 已完成

**Storage / Schema（§4/§5）**
- 补齐 5 个缺失字段：`source_branch_id`、`agent_role`、`expected_valid_days`、`access_count`、`last_accessed_at`，含旧库 `ALTER TABLE` 迁移（`hit_count`→`access_count` 回填）。
- 新增索引 `memories_semantic_key_idx` / `memories_tool_idx` / `memories_lifecycle_idx`。
- access heat 与 hit_count 分离：`access_count`/`last_accessed_at` 成为独立列，retrieval hit 同时递增两套（`hit_count` 保留以兼容 WebUI/旧测试）。

**Retrieval（§6/§7/§10/§24/§37/§38）**
- 检索评分改为 §10：BM25 70% + confidence 15% + verification 10% + recency 5%；scope/family 作硬过滤（不再软权重）。
- 新增 `verificationSignal()`：仅 deterministic 证据（confirmation / verified evidence / success_count）驱动 10% 权重。
- 中文检索落地：`Intl.Segmenter("zh", word)` 预分词写入 `search_text`（`segmentSearchText`），FTS schema 迁移为 `search_text / raw_content / tool_name`。
- `retentionScore` 已接线：`memory-lifecycle.js` 用它计算 low-utility 候选。
- 缓存友好：`<retrieved_memory>` 从 system prompt 尾部移到 user turn（直接拼进 user content 存储，历史字节稳定；file mentions 场景则折进 `model_content`）；system prompt 只保留稳定的 profile/guaranteed，稳定前缀 + 历史可命中 prefix cache。

**Concurrency / API（§35/§39/§48）**
- `updateMemoryWithRevision()` 实现乐观并发（`WHERE id=? AND revision=?`），facade 增加 `MemoryStore.update(id, patch, expectedRevision)`。
- `list_memory` 支持 `scope/family/kind/lifecycle` 过滤。

**Experience（§16–22）**
- `memory-experience-tracker.js` 重写为 Episode 状态机（open→failed→recovering→recovered→verified）。
- recovery detection 用 input fingerprint 区分「同命令重试」与「策略变更」（§19）。
- verification：`noteVerification()` 由 agent loop 在 test/build/lint 成功（`isVerificationCommand`）时触发（§20）；只有 verified 才写 lesson。
- 新增 `memory-experience-extractor.js` 确定性 extractor（§21），产出带 `verified:true` + `verification.type` 证据的 coding candidate。
- 错误分类扩到 12 类（`classifyToolError`，§22）；failure recall 增加 skip guard（§63）。

**Lifecycle / Prompt / Config（§13/§26/§43/§45/§62）**
- 新增 `memory-lifecycle.js`：`isMemoryStale` / `findStaleMemories` / `findLowUtilityMemories`。
- Dream 维护请求携带 `expected_valid_days` / `stale` / `retention_score` 信号，staleness 由 `lifecycle.staleness_review` 配置门控。
- Guaranteed 扩为 pinned + `user_correction`/`critical_project_rule`/`security_constraint`/`critical` 标签（§62）；global profile 补 conventions（§11.1/§14）。
- 配置补齐 `writeback` / `lifecycle` 块；`require_verification` 已被 tracker 真正消费；`agentRole` 可经 `save_memory` 写入。

### 77.2 仍遗留（P2/P3，未来项）

1. **Retrieval Adapter 抽象（§8/§47）**：未建 `memory-retrieval-adapter.js`/`-fts5.js`/`-fallback.js`。retriever 直接调 `searchFts`/`searchSubstring`，已满足当前功能；Adapter 只在未来加 embedding 时才需要（§46 明确默认不做 embedding，按 YAGNI 暂缓）。
2. **Consolidation / Contradiction 结构化输出（§28/§29/§32）**：Dream 维护提示词已能合并重复、归档矛盾/过期项，但输出仍是 `{items, archives}`，未实现 §32 的 `{promotions, staleness, consolidations, archives}` 四段结构（EXTEND 续期动作未单独建模）。
3. **Memory Budget token-aware（§44）**：仍是 `max_prompt_chars` 按字符截断，`bootstrap.max_tokens` 未参与截断；`retrieval/recovery.max_tokens` 未实现。
4. **Retention Capacity eviction（§61）**：`findLowUtilityMemories` 已提供 retention-score 排序原语，但未接入容量淘汰路径（现有 `max_items_per_scope` + 字符预算仍兜底）。
5. **Fork parent-join（§41）**：分支 candidate 落 inbox 后由 Dream 统一去重/合并，未做显式的 parent-join dedupe/evidence-merge 步骤。
6. **Query Expansion（§60）**：未实现 LLM/关键词扩展。
7. **Metrics（§51）**：未采集 retrieval_hits 等指标。
8. **`utility_score`/`hit_count`/`last_hit_at` 遗留列**：保留以兼容 WebUI 与旧数据，未从 schema 移除（SQLite STRICT 删列需重建表，收益低）。

### 77.3 测试覆盖

- 新增/更新：`memory-ranking`（§10 公式）、`memory-experience-tracker`（verified gate）、`memory-experience-extractor`、`memory-lifecycle`（staleness/retention）。
- 已有且保持通过：`memory-policy` / `memory-sqlite-store` / `memory-retrieval` / `memory-reinforcement` / `sqlite-storage` / `session-trajectory` / `transcript-reducer` / `coding-route-visibility` / `web-memory-settings` / `web-trajectory-debug-route`。
- 未覆盖端到端场景：Scenario G（staleness）、Scenario H（fork parent join）——对应功能见 §77.2。
- 待补测试文件（§70）：`memory-fts5.test.js` / `memory-fork-snapshot.test.js` / `memory-index-rebuild.test.js`。
