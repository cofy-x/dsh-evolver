# DSH Evolver 架构

[English](architecture.md) | [简体中文](architecture.zh.md) | [文档索引](README.zh.md)

DSH Evolver 是提案生命周期插件，不是 Agent 实现或自主代码编辑器。Agent、模型请求、工具、命令、规范 Session 历史、权限和凭据仍由 DSH 负责。

## 纵向 MVP

```text
失败 tools/result
  -> 有边界且脱敏的 observation
  -> 版本化精确失败模式
  -> 持久 generation reservation
  -> 确定性策略提案
  -> 确定性安全验证
  -> 人工接受或拒绝
  -> 显式提升
  -> 后续 Session 启动时通过有日志的 agent.inject() 注入上下文
  -> 按 exposure 归因的 outcome 窗口
  -> 确定性效果结论
  -> 人工保留或回滚
```

运行时观察不可变的最终 `tools/result`，忽略无 Agent 调用；只持久化结果元数据以及失败的有边界证据，绝不保存工具参数、成功值或返回内容。每次失败先增加一个精确模式，再考虑提案准入。提案从 `evaluating` 开始，经确定性验证转为 `pending` 或 `rejected`；人工接受将已验证 pending 提案转为 `accepted`，只有 accepted 才能提升。提升启动有边界评估；人工回滚把 promoted 提案转为 `superseded`。重复转换是幂等的。

## 模块职责

| 模块                       | 职责                                                 |
| :------------------------- | :--------------------------------------------------- |
| `domain.ts`                | 品牌化标识符、提案状态、审计词汇、服务/provider 接口 |
| `config.ts`                | Loader schema 和部署边界                             |
| `evaluation.ts`            | 纯 baseline/treatment 结论计算                       |
| `pattern.ts`               | 摘要规范化和版本化确定性模式签名                     |
| `proposer.ts`              | 确定性提案和离线安全验证 provider                    |
| `audit-codec.ts`           | 持久事件解析、验证和旧事件兼容                       |
| `audit-state.ts`           | 内部投影容器和身份查找辅助函数                       |
| `projection.ts`            | 重放以及集中生命周期/活动 generation 不变量          |
| `admission.ts`             | 基于最新锁定投影的纯失败准入计划                     |
| `evaluation-projection.ts` | Baseline 选择、treatment 更新和采样                  |
| `store.ts`                 | 公共存储 facade、串行事务、文件锁和原子提交          |
| `service.ts`               | 输入规范化、脱敏、provider 编排和生命周期准入        |
| `commands.ts`              | 仅供人工使用的 `/evolve` 查询、审查和提升操作        |
| `runtime.ts`               | Cordis 服务、命令、DSH 事件、注入和销毁接线          |

这些模块目前一起发布，因此保留在一个包内；只有 provider 或 consumer 拥有独立生命周期或分发需求时才拆包。依赖方向是 store → admission/projection/codec，projection → codec/evaluation-projection，codec 和 evaluation-projection → 纯 evaluation/domain。共享内部状态不包含 I/O 或业务编排。所有新提交或重放事件都经过同一 codec 和集中 reducer。

## 持久化和恢复

`$DSH_HOME/evolver/audit-v1.jsonl` 是唯一事实源。每个原子修改都会获取 DSH 文件锁、验证并重放完整流、在内存追加单调序号事实，再以 `0600` 原子替换文件。一次失败的 outcome、observation、模式创建/增加和可能的 reservation 一起提交。损坏 JSON、未知事件、序号缺口、重复 outcome key 或 occurrence 关联、无效引用、generation/评估投影不一致以及非法转换都会让启动失败，而不是返回部分状态。早期 MVP 和评估阶段日志无需改写即可重放；其提案按旧版无关联提案处理。

## 失败模式与提案准入

`failure-pattern-v1` 使用 Node SHA-256 对 `(version, toolName, errorCode, canonicalSummary)` JSON 元组签名。工具名和错误码是经验证的有界 token；已脱敏摘要会统一小写和空白，并把 UUID、长十六进制标识、独立数字 ID、URL、用户主目录和脱敏凭据占位符替换为稳定标记。字段边界保持显式，不同工具或错误码不会合并。这里只提供可复现精确匹配，不做语义相似或跨版本迁移。

Observation 是独立持久化的一次有界失败事实；pattern 是共享签名 observations 的确定性重放投影；proposal 是与触发准入的精确 observation/occurrence 关联、由验证器把关的一代策略。Pattern 保存 occurrence 数、首末时间、generation 关联和最多八个近期代表 observation ID。首次 occurrence 可创建 generation 1；evaluating、pending、accepted 或 promoted 会阻止同模式新 generation。Rejected 或 superseded 后必须再出现 `reproposalAfterOccurrences` 次匹配失败；默认五次，即 occurrence 6 创建 generation 2。Generation 的评估 cohort 相互隔离，且同一模式不能同时提升两代。

准入通过两次加锁包围潜在昂贵的 provider 工作：第一次事务记录 occurrence 并保留唯一 proposal ID/generation，owner 在锁外调用 proposer/verifier，第二次事务仅在 reservation 仍有效时写入提案和验证事实。Provider 失败会放弃 reservation 但保留 occurrence；崩溃遗留 reservation 在有界租约过期后由下一 occurrence 原子回收，旧 provider 的迟到结果会 fail closed。销毁会停止新准入并等待已准入 provider/持久化操作完成。

当前采用 JSONL，因为数据流小、写入少且可审计性比索引查询更重要。只有实测数据量或多进程查询需求超过整流重放能力时才应采用 SQLite。

## 评估循环

与 Agent 关联的最终工具结果在失败或相关 baseline/treatment 窗口仍收集时，贡献 outcome ID、Session ID、call ID、工具名、成功位和时间戳；窗口外成功结果丢弃，`(sessionId, callId)` 是幂等键。对模式关联提案，提升会从触发 observation 的审计边界开始冻结指定数量的 outcomes，必要时包含紧邻的触发失败；代际以审计序号而非毫秒时间分隔。Baseline 满后，后续仅失败事实不能挤掉已采样成功。旧无关联提案保持原有时间戳语义。`agent/session-start` 记录实际注入策略，仅相应 Session 的工具结果进入 treatment。

两个 cohort 达到 `minimumEvaluationSamples` 后比较失败率：差值不高于负阈值为 `improved`，不低于正阈值为 `regressed`，中间为 `neutral`，样本不足为 `insufficient`。固定 treatment 窗口满后停止收集。这只是透明的操作启发式，不建立因果或统计显著性，也不会自动回滚。

## 模型体验

提升前插件不增加模型 token，也不改变工具 schema。后续 `agent/session-start` 会把限定数量的提升策略合为一条插件 instruction，并通过 `agent.inject()` 排队。只有同步注入成功后才排队持久化 exposure，因此被拒注入不会产生虚假 exposure。Agent loop 会在模型请求前把消息提交为规范 Session 输入。Exposure 持久化与 Session 提交不是共享事务，具体限制见下文。

## 安全不变量

- 工具参数、成功值、结果内容、完整 transcript、推理和凭据不进入审计存储。
- 证据规范化空白、有长度上限，并脱敏常见凭据、URL 和主目录形式。
- 提案只是文本指导，不能执行工作。
- 验证器不能接受或提升；收集器不能绕过验证；提升不能绕过人工接受。
- 评估不能提升、拒绝或回滚；只有显式人工回滚能 supersede 活动指导。
- 插件销毁会移除事件/命令注册、停止新修改准入并等待写队列。
- MVP 不连接网络 endpoint。

## 暂缓适配器

约定有界候选/证据契约后，`dsh-as-a-verifier` 才可实现验证 provider。`dsh-automation` 可调度分析或重放 Run，但其队列、租约和恢复状态不移入本仓库。仓库已有默认无凭据的外部配对 benchmark harness，以及单独授权的真实 adapter pilot；产品集成效果测量仍在 MVP 外。传输账本仅用于串行测试，不是新的产品持久化协议。技能物化、Console/Trajectory 投影、LLM 提案 provider、共享网络和隔离 worktree 代码演进也暂缓。

## 操作限制和下一步验证

目前每个 data directory 只使用一个活动 runtime。写入准入跨进程序列化，但同步读取是进程本地快照，只在该 store 下次事务时刷新；另一 runtime 回滚后，本进程仍可能持有过期 promoted 投影。未来多 runtime 适配器需要在查询和注入边界定义显式新鲜度契约。Exposure 在同步 Session-start 通知后异步持久化，存储失败可能留下已注入上下文而没有持久测量 exposure；宣称 crash-consistent 归因前必须增加协调且可 await 的集成边界。

Reservation 过期允许其他 occurrence 回收所有权，但不会取消原 provider 调用；永不 settle 的 provider 仍会无限推迟销毁。外部 provider 启用前必须具备 deadline、协作取消、迟到结果隔离和已记录的销毁预算。当前确定性 provider 不执行外部工作。

整日志重放/替换、无限失败历史和重复评估扫描只适合实验规模。选择 SQLite 或 snapshot/compaction 前先测量代表性负载下的延迟和日志大小。存储后端不改善提案质量：固定诊断模板和结构验证器不能证明策略提升任务成功率。任务效果验证的下一步见[配对 benchmark](paired-benchmark.zh.md)。
