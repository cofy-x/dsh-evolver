# 配对恢复 benchmark

[English](paired-benchmark.md) | [简体中文](paired-benchmark.zh.md) | [文档索引](README.zh.md)

状态：离线 benchmark，加上显式授权、仅限 pilot 的真实 DeepSeek adapter 模式。[2026-09-06 授权 pilot](pilot-result-2026-09-06.zh.md) 已完成，两组均未在预算内完成三项目标；这不是正向效果证据。成功的 [live 生命周期 smoke](deepseek-smoke.zh.md)证明不同性质，不能复用为效果证据。默认仍无凭据；付费执行单独授权。

## 范围和入口

`pnpm run benchmark:offline` 构建 Evolver 并运行三组 pilot 任务对；`pnpm run test:benchmark` 构建后，通过真实随附 Headless 进程运行显式评分/完整性回归。`pnpm test` 包含纯任务 oracle、分区、调度、报告和既有预算测试。需要 Node 24、pnpm 11，以及[运行时验证](runtime-validation.zh.md)所述的已构建相邻 Harness checkout。CLI 参考为 `node scripts/benchmark.mjs --help`；可用 `--harness=PATH` 指定宿主。

Runner 只写入生成的临时实验目录，并在成功/失败后删除其中的规范 Session 和 Evolver journal。子进程日志丢弃，安全结构化 JSON 报告写入 stdout。离线模式不检查或继承真实 key，并阻断外部网络。唯一暴露工具只修改 closure 内模拟 record，不具备文件系统、shell、网络或评分能力。这些是可信插件上的测试控制，不是 OS 安全 sandbox。

## 职责

- `scripts/benchmark/tasks.mjs`：版本化 development/pilot/heldout fixture、合成工具世界、独立精确状态 oracle 和显式白盒离线响应脚本。
- `scripts/benchmark/driver.mjs`：每个 arm 一个全新随附 Headless 进程、公共 Agent/tool/Session 执行、journal 准备、guidance 检查、请求/工具上限和 teardown。
- `scripts/benchmark/report.mjs`：可复现 pair 排序和描述性配对 outcome/成本差值；不使用 Evolver 失败率结论。
- `scripts/benchmark.mjs`：进程隔离、timeout、完整 run ledger、跨 arm 完整性检查、实现/fixture fingerprint 和清理。
- `scripts/runtime-e2e/host.mjs`：与 smoke runner 共用的公共 export 解析和隔离 profile 入口清单；不改变产品 API 或 audit 协议。

## 实验单位和 treatment

每项任务各有 baseline/treatment，两者都是真实随附 Headless 调用，工具 schema、任务 prompt、模型配置、初始状态和预算相同。Byte-identical 的 accepted proposal journal 会复制到每个 arm 的独立 DSH home，只有 treatment 在任务开始前提升提案。每个 arm 都使用新规范 Session 和进程。同一 pair 两边使用相同空 workspace path，模拟世界彼此全新独立；任务之间不复用 Session 或演进后的 promoted strategy。

Seed 来自 development fixture 对工具世界故意提交的一次失败，并通过公共 Evolver 服务、现有确定性 proposer/verifier 和公共 accept/promote 操作生成。这是 service-level 合成训练，不是模型生成训练或新学习算法；heldout 答案和参数不进入 seed。任务执行中新失败可以产生 pending proposal，但 runner 不会提升，运行期间 guidance 冻结。

当前 proposer 对三类任务的同一工具/错误码输出相同通用诊断策略，因此实验测量通用恢复建议，不是任务特定知识、语义匹配或自主源码演进。Benchmark 不会篡改 proposer 以制造提升。

首次真实适配器响应前，driver 检查 baseline 无 guidance、treatment 有 guidance。Controller 在只移除 Evolver instruction message 后比较完整首个模型可见请求 hash；忽略消息 ID/source metadata，但不规范化消息文本、system、tools 或 model。初始状态、seed journal 和 guidance hash 必须一致，规范持久 user message 也会检查。比较失败会使 pair invalid，而不是计为策略失败；之后历史随操作自然分叉，无需全请求相等。

## 任务库和评分

任务库包含三个 development、三个独立 pilot 和十二个 heldout 实例（每类四个）。ID/参数互不重叠，prompt/schema/world rule 和分区均版本化。Heldout 只保留给 live strategy tuning 之外使用；fixture 对开发者和白盒离线 oracle 可见，不构成保密或外部 benchmark 声明。

| 类别         | 目标               | 可恢复失败            | 独立 oracle    |
| :----------- | :----------------- | :-------------------- | :------------- |
| Precondition | 保存请求值         | revision 过期         | 精确保存值     |
| Format       | 保存满足校验的记录 | 值不是大写            | 精确规范化目标 |
| Batch        | 完成指定队列       | 过大 batch 被原子拒绝 | 精确完成项集合 |

Prompt 描述目标而非正确工具序列。只有离线响应生成器知道答案；工具 inspect/error 正常暴露可恢复约束。非法 batch 不得部分修改状态。Assistant 声称 “Task complete” 没有评分权；`goalReached` 是精确状态 oracle，`success` 还要求在预算内正常结束，所以状态已正确但继续失控调用会被观察到，却不算有界成功。

报告保留每个计划 pair 的两个 arm。通过请求准入后的预算耗尽和 timeout 计为 unsuccessful；被终止进程的未知计数保持 null 而非零。Infrastructure、污染、缺少完整性证据、执行中实现变化和未开始运行显式保持 invalid/incomplete，并与计划分母一起报告，不自动补跑。存在 invalid pair 时报告非零退出；有效报告即使有任务失败也可零退出，因为失败是合法测量结果。

主要描述输出为配对表：双方成功、仅 treatment、仅 baseline、双方失败及 invalid pair。Rate delta 是有效 pair 上 treatment 减 baseline，并同时报告计划/有效数量。每 pair 差值包含 call、重复相同非法 call、request、input/output units 和耗时。离线 units 是序列化字节估算且 `usage` 为 null，不能称为真实模型 token；延迟含启动/关闭，不是 provider latency。报告不输出 p-value、统计显著性或自动 promotion 决策。

## 可复现性和限制

Seed 确定性排序任务，arm 顺序交替 baseline-first/treatment-first；三个 pair 无法完美平衡，因此报告保留精确执行顺序。该 seed 不是模型采样 seed。除 guidance 外，两边模型 prompt/tool 配置相同；默认脚本行为也相同，所以预期成功率差为零。

报告包含 fixture、plan、implementation、initial-state、seed-journal 和 guidance hash，以及产品/Harness SHA 和 dirty flag。实验前后检查实现内容，执行中变化会使比较无效。不同实验生成的 seed journal ID/time 不同，但同一 pair 接收相同 accepted bytes；跨实验重跑无需 journal hash 相同。

`report.mjs` 中 `BOUNDS` 定义离线上限：每 arm 四次模型响应、六次获准工具调用、每响应 512 output units、每请求 4,096 input units、每进程 45 秒、总计六分钟。Pilot 共六次运行，最多 24 请求、12,288 预留 output units 和 98,304 input units。`--run-timeout-ms` 只能降低进程上限。父进程会终止卡死子进程、等待退出、保留 timeout/完整性证据并清理临时数据；这不证明外部 provider 的取消行为。

## 离线验收

默认同脚本 pilot 必须得到三个双方成功 pair、零成功率差，并显示额外 guidance 输入开销。回归场景有意制造无状态变化却宣称成功、重复非法调用、额外 inspect、请求预算耗尽、基础设施失败、baseline guidance 泄漏和永不结束响应，必须正确识别。脚本 treatment-only 成功只是评分测试，不是 guidance 导致提升的证据。

## 真实 adapter pilot 契约

构建后，`node scripts/benchmark.mjs --adapter=deepseek-fixture` 通过本地 provider SSE 测试随附 DeepSeek adapter，包括并行工具调用。`pnpm run test:benchmark-adapter` 检查该路径、429 不重试、挂起传输终止和付费 CLI 拒绝边界。Fixture usage 是明确的合成值（每响应 100 input/10 output），不是真实 token 证据。Live 模式拒绝故障开关。

取得明确额度授权且 ENV 已设置 `DEEPSEEK_API_KEY` 后，运行 `node scripts/benchmark.mjs --adapter=deepseek-live --allow-paid=yes --model=deepseek-v4-flash`。使用相同冻结 pilot 任务库、工具 schema、prompt、grader、合成 accepted seed 和 guidance，仅由真实模型响应决定执行操作。两种 DeepSeek 模式均禁止脚本覆盖和 heldout 执行。模型由 CLI 明确选择；凭据只引用 ENV，不作为命令参数。不使用自定义 endpoint 或其他继承配置，仅准入官方 HTTPS chat-completions，拒绝重定向、关闭 thinking、每请求最多 512 output tokens，并关闭 adapter 重试和 retry 插件。不自动重试付费请求或替换 arm。

`transport.mjs` 在传输前校验完整 wire 并预留预算。一份 owner-only 账本贯穿全部六个串行子进程，controller 等待前一个退出后才允许下一写入者；每次请求前原子替换账本，因此失败传输和被终止进程仍占用预留。这是串行测试控制器，不是通用并发预算服务或可崩溃恢复实验。上限为每 arm 4 请求/6 工具调用/45 秒，全实验 24 请求/98,304 保守 input 字节单位/12,288 预留 output tokens/6 分钟。Input 预留不是计费 token；live `usage` 记录 adapter 报告的含缓存 input 和 output，缺失或非法 usage 使运行无效。传输模式的 `outputUnits` 为 token，脚本模式为字节，不能跨模式比较成本差值。

首次请求在公共 adapter options 和实际 wire 两处比较，仅排除 promoted guidance 消息；仍检查规范 exposure、audit 隐私、实现 fingerprint 和全部计划行。Fetch abort 最长 15 秒，adapter idle timeout 为 15 秒；即使 teardown/provider 卡住，父进程 deadline 仍为最终边界。终止进程不证明服务端停止计费。报告保留可用的部分 usage 和实验级预留，即使每 arm 计数未知。HTTP/provider 失败属于 infrastructure，不是反对策略的证据。实验不改变产品持久化，也不建立多 runtime 一致性。

Pilot 可行后，必须在查看结果前冻结独立 heldout 计划，包括重复次数和新预算。不能针对 heldout 失败调优 guidance 后把重测冒充原实验。天花板效应、无提升或退化都属于有效结果；任何更广泛任务效果结论都需要更多任务/重复及不确定性分析。
