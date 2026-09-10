# 配对任务有效性实验

[English](paired-benchmark.md) | [简体中文](paired-benchmark.zh.md) | [文档地图](README.zh.md)

Benchmark 独立于 Evolver 的失败率启发式，测量精确状态任务完成情况。离线 fixture 验证链路与评分，不证明策略有效性。真实提供方执行始终需要单独的模型与聚合预算授权。

## 离线门禁

按照[验证指南](runtime-validation.zh.md) 准备兼容宿主，然后运行相关 [package scripts](../package.json)：

```sh
pnpm run test:benchmark
pnpm run test:benchmark-adapter
pnpm run benchmark:offline
pnpm run test:experience
node scripts/benchmark/diagnostics-check.mjs
```

Experience 门禁通过本地 SSE 驱动真实 DeepSeek adapter，覆盖 development → training → lifecycle → 独立进程 recovery → freeze → heldout evaluation。故障检查包含结果未送达、429 无重试、deadline、污染和无效评分。不读取真实 key，阻断外网。临时 home、Session 与 journal 会被清理，只保留安全报告。这是针对可信插件的测试控制，不是 OS 沙箱。

## 实验契约

每对使用全新进程和 Session，相同 accepted seed 字节、初始状态、prompt、schema、模型和预算。只有 treatment 晋升指导。Canonical 历史与首个序列化请求必须证明预期指导差异；仅移除该指导后，模型可见请求必须相同。污染、实现变化或缺失完整性证据使 pair 无效，而不是记为策略失败。

版本化[任务库](../scripts/benchmark/tasks.mjs) 将前置条件、格式和原子 batch 恢复划分为 development、pilot 与 heldout 实例。Heldout 指不参与真实调优，不代表对开发者保密。独立精确状态 oracle 忽略 assistant 的完成声明。`success` 还要求在边界内正常结束：达到目标后耗尽预算仍为失败。

保留所有计划 arm，包括任务失败、无效基础设施结果和未启动项。未知计数保持 null。不自动替换失败，也不从计划分母删除。报告双方成功、仅 treatment、仅 baseline、双方失败及无效 pair，并列出有效/计划数量与开销差。序列化字节估计和 fixture usage 不是计费模型 token；耗时包含进程开销。描述性差值不证明因果或统计显著性。

当前确定性提案器输出通用工具/错误恢复建议。旧 pilot 使用服务级合成训练；experience controller 通过真实模型/工具执行诱发明确的 development 失败。二者都不是自然采样的生产学习，也不是任务特定知识学习。

<a id="真实经验与冻结-heldout-流程"></a>

## 新的真实实验

申请费用授权前，查看 `node scripts/experience.mjs --help` 与 [experiment-ledger.mjs](../scripts/benchmark/experiment-ledger.mjs) 中的限额。使用新的实验状态目录和 plan 路径，绝不复用历史计划。Live 阶段要求 `--mode=live --allow-paid=yes`，固定官方 endpoint 的 `deepseek-v4-flash`，仅读取已提供的 `DEEPSEEK_API_KEY` 引用。凭据不得进入参数或报告。

依次执行 `development`、`training`、`lifecycle` 和 `recovery`，始终复用同一 `--state=PATH`。Ledger 在传输前预留，失败调用也计入，并保留 evaluation 容量。缺失/损坏 ledger、未完成 run 和重复占用阶段均关闭式失败；不得重置状态恢复预算。`--phase=status` 无需凭据即可读取安全账目。单独标识的重试 attempt 需要显式决定，保留原证据并消耗同一 ledger。

Development 必须先证明精确状态可行性才能 training。Lifecycle 和 recovery 必须证明 accepted 指导排除、canonical 与实际 wire 晋升、曝光范围结果、回滚、重放和 dispose。这些门禁不认证策略质量。

通过后，用相同 live 选项运行 `--phase=freeze --plan=PATH`，不调用模型地写入新计划。本地审查并提交后，才能执行 `--phase=evaluation --plan=PATH`。Evaluation 在读取凭据前拒绝未提交/变更计划、实现或 seed journal 变化及模式不匹配。Heldout 使用前冻结任务、顺序、候选、预算、oracle 和报告；该实验不包含 heldout 后调优或替换。

[旧 runner](../scripts/benchmark.mjs) 仅用于 pilot，其 `--help` 说明 offline/fixture/live 模式。限额以 [report.mjs](../scripts/benchmark/report.mjs) 和 [transport.mjs](../scripts/benchmark/transport.mjs) 为准，不支持 heldout DeepSeek 任务。所有付费 controller 禁止自动重试、拒绝 endpoint 覆盖，并区分预留与报告 usage。输入边界是保守准入估计，不是保证的计费 token 上限。杀死超时 child 不证明远端已取消或停止计费。

## 保留证据与下一步决策

[2026-09-06 pilot](pilot-result-2026-09-06.zh.md) 两组成功率均为 0/3。后续回归定位到结果 renderer 缺陷；原负面报告保持不变，修复 renderer 不能追溯验证它。

[2026-09-08 experience 结果](experience-result-2026-09-08.zh.md) 及[冻结计划](experience-heldout-v1.json) 保留生命周期来源和六对双方成功的 heldout 结果。成功率差为零且受天花板限制，不是增益证据。这些文件是历史证据，不是可覆盖的模板。

下一次有效性研究应使用能区分策略的任务，在评估前冻结候选，并保留成本与失败。Runtime 或依赖升级需要离线验收，不意味着付费重跑或改写历史结论。
