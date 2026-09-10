# 真实经验与 heldout 结果 — 2026-09-08

[English](experience-result-2026-09-08.md) | [简体中文](experience-result-2026-09-08.zh.md) | [执行流程](paired-benchmark.zh.md) | [冻结计划](experience-heldout-v1.json)

真实 DSH 的经验 → 提案 → 验证 → 公开人工审查命令 → 提升 → 独立任务评估 → 回滚/恢复链路，已在隔离实验 home 中跑通。六组 heldout 两边全部成功，无无效配对：**baseline 6/6、treatment 6/6、成功率差 0**。这是天花板结果，不证明通用策略提高成功率、两者等价或可推广到生产任务。看到这些结果后没有新增 live 运行。

## 此前失败的原因是什么？

[2026-09-06 首次 pilot](pilot-result-2026-09-06.zh.md)及两组 0/3 的结果原样保留。无凭据复现确定了一个实验缺陷：公共工具 renderer 接收 `(args, value)`，旧 benchmark 却使用单参数 renderer，把参数而非成功工具 body 的结果返回给模型。白盒模型 fixture 独立知道答案，掩盖了语义丢失；此前的请求相等检查没有证明正确传递工具结果。这是实验 driver 缺陷，不是已证明的 DSH core 缺陷。

新 `recovery-protocol-v2` 修正 renderer，并明确合法 action/payload 说明，不泄露 grader 或隐藏值。诊断验证 body → 渲染结果 → 后续 adapter options → 实际序列化 wire，只保留有界 action/error/progress/delivery 事实。任务库和精确状态 grader 不变。由于 renderer、schema 和单次运行预算都与首次 pilot 不同，新结果不能分别归因，也不能证明 renderer 是所有旧失败的唯一原因。

首次新 development 又暴露一个实验断言缺陷：评估窗口之外的成功操作合法地不创建 audit journal。两个已执行任务均达到目标，却被判 invalid；连续两次 invalid 后第三项停止。保留原报告后，通过离线 success-only 回归修复，显式 attempt 2 在同一账本写入独立报告。第二次的 batch 已达到精确目标，随后又请求检查，正常结束前耗尽六请求。因此仍为预算失败，没有事后改判成功。这支持有限预算下停止行为/模型行为的问题，而非持续的结果传递缺陷。

## 全部 heldout 前计划运行

P/F/B 分别表示 `development-precondition-1`、`development-format-1`、`development-batch-1`。Goal 是模拟状态精确匹配；成功还要求在预算内正常结束。Token 列为 provider 报告的含 cache input 和 output。横线表示未开始，不伪造测量值。

| 阶段 / 任务              | 状态                        | Goal | 请求数 | Input / output tokens |
| :----------------------- | :-------------------------- | :--- | -----: | --------------------: |
| Development 1 / P        | Invalid：runtime assertion  | 是   |      3 |           2,051 / 169 |
| Development 1 / F        | Invalid：runtime assertion  | 是   |      4 |           3,037 / 317 |
| Development 1 / B        | 未运行：infrastructure stop | —    |      — |                     — |
| Development 2 / P        | 完成                        | 是   |      5 |           4,275 / 553 |
| Development 2 / F        | 完成                        | 是   |      3 |           2,108 / 235 |
| Development 2 / B        | 失败：request budget        | 是   |      6 |           5,587 / 647 |
| Training / P             | 完成                        | 是   |      4 |           3,850 / 642 |
| Training / F             | 完成                        | 是   |      4 |           3,363 / 584 |
| Training / B             | 完成                        | 是   |      6 |           6,094 / 738 |
| Lifecycle / P，含 probes | 完成                        | 是   |     12 |           9,822 / 671 |
| 独立进程 recovery / P    | 完成                        | 是   |      5 |           4,048 / 425 |

Development 2 的失败 batch 序列是 `inspect → commit(batch-limit) → commit → inspect → commit(goal reached) → inspect → request-budget`。已传递结果均通过语义检查；最后一次 inspect 因准入停止，没有后续 wire 请求。Development 2 / P 还从一次 `stale-revision` 失败恢复。两次 development 都没有改标签或从记录分母中移除。三类 development 的精确状态目标均可行；严格预算内完成为 2/3，后续独立受控训练演练则在相同六请求限制内完成 3/3。

## 真实经验与审查来源

每个训练 prompt 请求一次明确非法的 development 操作及恢复，实际工具调用由真实模型决定；format 和 batch 在非法写入前先执行了 inspect。这是受控失败演练，不是自然采样的生产失败。提案通过公共最终 `tools/result` 事件接纳 observation 并生成，而非直接调用合成 `observeToolFailure()`。未改变的确定性通用模板按观察到的工具/错误码提供条件性建议，没有学出新的恢复算法，也没有引入恢复目录。

| 失败码               | 已接受候选                             | Generation / 准入 occurrence |
| :------------------- | :------------------------------------- | :--------------------------- |
| `STALE_REVISION`     | `a2325035-5fee-4478-b64a-caa69f3c1b12` | 1 / 1                        |
| `UPPERCASE_REQUIRED` | `5be29abd-cb87-4146-8c97-08b99f3b6634` | 1 / 1                        |
| `BATCH_LIMIT`        | `7a0901f1-9f30-4a9a-b7f1-8f5d35c05c65` | 1 / 1                        |

冻结计划保存 observation/pattern ID、verifier 身份、seed journal 与 guidance hash。`deterministic-safety-v1` 通过其离线结构检查；这不是效果验证，也不是 `dsh-as-a-verifier` 集成。公开 `/evolve accept` 命令仅在隔离 home 模拟人工接受；产品没有变成自动接受或提升。

使用真实 precondition 候选，生命周期运行验证了 accepted 无指导、公开提升、新 Session 的规范历史与实际请求有指导、恰好一个已暴露 treatment outcome，以及既有未暴露 Session 不贡献 treatment。公开 rollback 排除后续 Session 的指导。Evolver disposal 后，独立测试工具仍执行真实模型请求的失败操作，但 journal 字节完全不变，命令注册也已消失。独立进程在新活动前精确恢复 pattern、proposal、observation 数量和 evaluation，且不注入 superseded 指导。每个家族的独立评估 arm 均使用相同的公开提升边界。

通用指导仍是条件性文本，不是强制语义任务路由或跨 pattern 去重。实验 home 只含对应家族的 accepted seed，不能据此验证混合生产策略库。[架构](architecture.zh.md)中的单运行时存储、exposure 持久性和跨存储限制仍存在。

## 冻结 heldout 结果

计划在任何 heldout 请求之前提交为 `9aa7254d78e59ff7466ff54a5037d89ef0d4b4af`，hash 为 `87a99d8f2bce5a7fb4c0ba7ee8f9e44ea2b746ac452a3c529d7952409c64128b`。六组覆盖每类 heldout 实例 1、2，使用调度 seed 17 和交替 arm 顺序。每个 arm 上限为六请求、十次准入工具操作、90 秒，并遵守共享 30 秒请求时限与总账本。没有重试、替换、策略/grader 修改、invalid、超时或未开始的 heldout arm。

下表每行对应两个已正常完成且精确目标成功的 arm，数值均为 baseline / treatment。Input/output 是实际 token，不是 admission units；时间包含子进程启动和清理，不是纯 provider latency。

| Heldout 任务   |  请求数 | 工具调用 |    Input tokens | Output tokens |         耗时 ms |
| :------------- | ------: | -------: | --------------: | ------------: | --------------: |
| batch-2        |   6 / 6 |    5 / 5 |   5,600 / 5,831 |     624 / 578 |   8,735 / 6,833 |
| precondition-1 |   3 / 3 |    2 / 2 |   2,140 / 2,330 |     270 / 260 |   3,750 / 3,341 |
| precondition-2 |   5 / 3 |    4 / 2 |   4,102 / 2,285 |     443 / 212 |   5,783 / 2,764 |
| batch-1        |   6 / 6 |    5 / 5 |   6,077 / 6,036 |     679 / 579 |   7,269 / 6,948 |
| format-1       |   3 / 3 |    2 / 2 |   2,082 / 2,277 |     203 / 244 |   4,493 / 3,881 |
| format-2       |   3 / 3 |    2 / 2 |   2,144 / 2,305 |     256 / 236 |   3,936 / 3,430 |
| 合计           | 26 / 24 |  20 / 18 | 22,145 / 21,064 | 2,475 / 2,109 | 33,966 / 27,197 |

六组均通过仅移除 promoted guidance 后的首个 adapter options/wire 相等检查，以及初始状态/accepted seed/guidance 一致性、规范历史/实际请求 exposure、隐私、结果传递和 disposal 检查。所有 treatment Session 实际看到选定候选，baseline 均未看到。Heldout 唯一工具失败是 batch-2 baseline 的一次 `batch-limit`，随后恢复；没有重复相同非法调用。工具失败更少不是主要成功指标。

配对计数为双方成功六组，仅 treatment、仅 baseline、双方失败和 invalid 均为零。Treatment 在本样本少两个请求和工具调用、少 1,081 input tokens、少 366 output tokens；请求差来自 precondition-2 baseline 的额外 inspect。Input 预留为 84,958 / 83,681 units。这些只是六组单次配对的描述性成本观察，不是可信的因果效率提升。没有成功率改善证据，也没有事后调优。

## 共享预算与保留证据

所有新 live 阶段使用同一 `.cache/experience-20260908` 账本：**102 请求、342,534 预留 input admission units、104,448 预留 output tokens、87,444 已报告 input tokens（含 cache）、9,565 已报告 output tokens、144,570 ms 累计 live 子进程墙钟**。每个请求均有 usage，没有重试；冻结评估占其中 50 请求。保留 58 个未使用额度，授权是上限而非花费目标。旧 pilot 独立的 24 请求不计入本任务新请求。

以上低于授权的 160 请求、1,310,720 input admission units、163,840 预留 output tokens 和 20 分钟。每次传输前先准入，上限为 8,192 input admission units、1,024 output tokens、30 秒。Input admission units 是保守字节数加开销，不是实际 token 或货币费用。进程时限不能证明 provider 端取消或最终计费。

安全报告和有界 accepted/recovery journal 保留在 ignored state 目录；原始 Session、工具参数/结果和模型 transcript 只存在于临时目录，子进程退出后已删除。没有把用户源码、真实 Session 库或凭据复制进 Evolver 存储。保留报告的字节 hash 为：

| 报告                  | SHA-256                                                            |
| :-------------------- | :----------------------------------------------------------------- |
| `development.json`    | `90602eb6dd4bd90cd58a8310730c9cfe063f826c108fda36f40fbadbcd760714` |
| `development-r2.json` | `503d5475602662c7489b423eee910597c7c961cfc241439bca1f7d0650367bf3` |
| `training.json`       | `44d5e742a0dc7d0bb438adc08a025ff0655077446eabcddb8f1fed02147820cb` |
| `lifecycle.json`      | `48b7f4a92fe6c7faedf2d18038b8543ac54efa79270df0bc34b2aa713de63db0` |
| `recovery.json`       | `0233f61d78a154c345613e57c64b9f1da4187deb1f5f5f7b1d62484899da32b1` |
| `evaluation.json`     | `811d10797cd73cb999870f653a934c630869dc2178ee2587ce50b401ecf2364d` |

## 复现与范围

在安装锁定依赖并构建好的开发 checkout 中运行 `pnpm run test:experience`，即可执行无凭据完整闭环和故障测试。显式 live 命令、同账本要求和先提交再评估门禁见[执行流程](paired-benchmark.zh.md#真实经验与冻结-heldout-流程)。已占用的 live 阶段不能覆盖这些证据重跑；新的付费实验需另行声明版本并符合授权，不得重置本任务预算。

执行环境：macOS 26.5.2 arm64、Node `v24.16.0`、pnpm `11.7.0`；已构建 DSH `0.1.3-alpha.1`，干净源码 `d347e703908d0406b7a7ef80e3a0e594d86b2215`。两次 development 使用干净产品提交 `20049da16aadc1cf3e1a30f27755b24f8d9b6238`、`5638d72313a0b421e2a75273c9663782535022d6`；training/lifecycle/recovery 使用干净 `bd5ad4f6cfe77381e5b67418b00309ea3a829a10`；heldout 使用干净 `9aa7254d78e59ff7466ff54a5037d89ef0d4b4af`。后三类阶段及 heldout 的最终实现 fingerprint 始终不变：`2dc7b523f2be527c547b5fa922df583902617aa5c0c3b3a2b100d442cd513549`。

标准 format/lint/typecheck/unit/build/package 与公共 ESM 检查通过，随附 Headless/Web、无凭据 DeepSeek adapter/故障、benchmark 完整性、旧 renderer 诊断和完整 experience 闭环也通过。Web 仅为启动检查，不是浏览器覆盖。本次实现变更是实验诊断、修正并版本化的协议、可重复控制器；产品生命周期 API、持久化事件词汇、确定性 proposer 和安全边界不变。未 push、tag、发布 npm，也未扩展 UI、共享网络、自动源码修改或部署。可支持的结论是链路可用、任务可行，**不是已证明策略有效**。
