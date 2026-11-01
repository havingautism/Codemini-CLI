# 日常 / 编码模式验证记录（2026-10-31）

## 结论

主链路的针对性回归 72/72 通过，Web 构建通过。不能据此认定所有使用场景均无问题：全量快照仍有 5 项失败，浏览器视觉与点击实测未完成。后续已修复输入草稿及附件跨会话隔离，见下文。

测试使用 `scripts/run-tests.js` 隔离真实用户配置，模型请求发往本地模拟服务，没有调用真实模型供应商，也没有更改真实账号配置。工作区开始时 Git 状态干净。

## 本次修复

| 问题 | 修复与证据 |
| --- | --- |
| 日常 Souls 缺少 Default，选择 Default 会退回编码分类及其 guard | 新增 `souls/daily/Default.md`；新配置与不存在的日常 preset 使用日常 Default；保留已有明确选择的 Playful 等设置 |
| 同名 Soul 详情只按名称查询，分类切换不会重新加载 | 详情 API 传递 category，组件 effect 同时依赖分类 |
| 切换 Soul 返回成功，但现有会话下一请求继续使用旧人格 | 保存后刷新运行池配置；真实 HTTP 集成测试验证下一请求使用 Soft |
| Soul 激活失败被客户端当作成功处理 | API 抛出失败结果；快捷切换显示错误，详情面板已有回滚逻辑得以生效 |
| 无效、跨会话或磁盘文件缺失的附件会静默消失 | 发送前校验 ID 与文件，失败返回 400，要求重新上传；重复 ID 去重 |
| 损坏或伪装的图片上传后仍被当作图片发送 | 上传时检查图片格式，按解析出的格式设置 MIME；损坏图片返回 400 |
| 上传或提交超过 8 个附件会静默截断 | 服务端明确拒绝超限请求 |
| 工具折叠行 hover / focus CSS 选择器残缺 | 恢复完整规则，保留现有布局与焦点设计 |
| 重新索引未改动文件也改变知识图谱版本 | 计算版本前稳定排序，不改变原索引数组；原有失败回归现已通过 |

## 覆盖范围与边界

| 场景 | 验证方式与结果 |
| --- | --- |
| Windows / Linux / macOS 的日常及编码 prompt | 组装测试通过，包含直接执行与已有沙箱变体；并非在三个真实系统上运行 |
| Soul、模式、项目指令、语言及记忆的位置与重复 | 组装与实际本地模型请求测试通过；所有内置 Soul 的分类及单一 guard 已检查 |
| 用户正文与附件块重复 | 集成测试确认正文与 `<uploaded_attachments>` 各一次 |
| 日常 → 编码 → 日常、人格切换 | 真实 Web HTTP 接口及捕获的模型请求验证通过，历史首条多模态内容保持一致 |
| 图片与 Word 联合上传发送 | 上传、下载原文件、压缩后的 image_url、提取正文、历史 UI API 附件均通过 |
| PowerPoint / Excel / PDF | PPTX、XLSX 上传提取通过；PDF 使用已有提取测试，未另做 PDF 的完整 HTTP 发送场景 |
| 图片重发、重复 ID、后续轮次与会话持久化 | 新集成测试及已有图片历史 / SQLite / 重试回归通过 |
| 不支持文件、损坏图片、空上传、超限、跨会话 ID | 新增 HTTP 集成测试通过 |
| 技能与附件、重试上下文、工具模式隔离 | 已有实际请求及模式 smoke 测试通过；未枚举所有第三方技能 |
| 会话切换的 busy 状态、队列、卡片交互代码 | 相关已有自动化测试通过；不能替代浏览器交互实测 |
| UI 构建及机械扫描 | 构建通过；扫描仅提示现有 Geist Mono 字体与 bounce 动画，未视为本次功能缺陷 |
| 桌面 / 手机视觉、键盘、粘贴 / 拖拽、真实模型识图质量 | 未完成页面实测，不给出通过结论 |

实际请求样本的 system prompt 为日常 6107 字符、编码 7679 字符。样本包含测试项目指令，数字受环境路径影响；这不是 token 数、账单节省或模型质量指标。

## 剩余问题

### 后续已修复：输入草稿及附件按会话隔离

原问题：`MemoInputBar` 没有会话 key，输入文本、附件与文件引用共用本地 state；进行中的上传回调也未绑定会话。

修复：Shell 为当前页面创建按 sessionId 索引的草稿存储，InputBar 按会话挂载，使用 `useSyncExternalStore` 读取对应草稿。文本、附件、文件引用、技能、笔记上下文、动作参数及上传错误 / 状态均隔离。切回会话恢复自己的草稿，迟到的上传回调始终更新发起会话。发送显式携带 sessionId，发送成功只清理仍与提交快照一致的字段，避免抹掉后来输入的新草稿；发送失败保留草稿。

草稿仅保留在当前页面的内存中，刷新页面不恢复；本次没有新增磁盘或浏览器持久化。新增 `composer-drafts.test.js` 与 `composer-draft-hook.test.js` 覆盖延迟上传、失败重试、跨会话并发、迟到发送清理及 React hook 会话绑定。最终草稿、会话与 HTTP 上传 / 重试回归 48/48 通过，Web 构建通过。React hook 使用服务端渲染测试，不能替代浏览器 DOM 交互实测。

### 全量回归剩余 5 项失败

以下失败在本次修改前的非沙箱全量测试中均已出现：

| 测试 | 当前证据 |
| --- | --- |
| `chat-empty-state.test.js`：quiet welcome | 期待 `codemini-welcome-brand`，现组件没有该元素；未确定应恢复设计还是更新过时断言 |
| `web-disclosure-tree.test.js` | 修复 CSS 后继续失败于 `codemini-answer-fold ...` 结构断言；当前 MessageBubble 结构不同，需要另行对齐设计与测试 |
| `crew-events.test.js`：completion before wake | 预期 worker.completed，实际 worker.interrupted |
| `crew-review.test.js`：conflicted worker resume | 预期完成合并，实际 mission 仍 active |
| `write-coordinator.test.js`：shell wrapper | 子 shell 退出 127，预期 0；尚未完成 Windows shell 环境与实现归因 |

首次非沙箱全量测试的两个终端失败，在最终全量测试中均通过：ANSI 转义输出断言及临时目录 EBUSY，表现具有环境 / 时序敏感性。

## 运行记录

- 沙箱全量：1395 通过 / 53 失败 / 5 跳过。大量失败为回环连接 `EACCES`，不能据此归因产品。
- 修复前非沙箱全量快照：1441 通过 / 8 失败 / 5 跳过。
- 修复后非沙箱全量快照：1447 通过 / 5 失败 / 5 跳过，共 1457 项。
- 随后增加全部内置 Soul 与正文不重复断言，最终针对性测试：72 通过 / 0 失败。
- `npm run build:web` 通过，仍有大 chunk 提示。没有手工修改生成的 dist 文件。
- `git diff --check` 通过。

本地详细日志位于 `.tmp/daily-coding-final-full-tests.log`、`.tmp/daily-coding-final-focused-tests.log`、`.tmp/daily-coding-final-build.log`。日志为当前工作区验证产物，未纳入版本控制。

浏览器边界：内置浏览器访问本机 QA 服务返回 `net::ERR_CONNECTION_TIMED_OUT`；本机 Edge 自动化因无法可靠确定当前 URL 而停止。没有绕过该限制，也没有将 HTTP 测试称为页面视觉或点击验证。

新增回归文件：`tests/web-mode-attachments.test.js`、`tests/web-soul-api.test.js`；Soul 分类测试位于 `tests/soul-categories.test.js`。
