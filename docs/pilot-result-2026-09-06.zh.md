# 已授权真实 adapter pilot — 2026-09-06

[English](pilot-result-2026-09-06.md) | [简体中文](pilot-result-2026-09-06.zh.md)

明确授权后执行了一次[配对 pilot](paired-benchmark.zh.md)，无重试、替换 arm、prompt/grader 修改或付费补跑。这是负向任务结果，不是成功的策略效果实验；运行链路和测量检查通过。

## 冻结执行

命令（需要已构建相邻 Harness，且 ENV 已设置 `DEEPSEEK_API_KEY`）：`node scripts/benchmark.mjs --adapter=deepseek-live --allow-paid=yes --model=deepseek-v4-flash`。只使用官方 endpoint，key 仅引用 ENV，不打印或写入配置。此前离线门禁不使用真实模型。

产品实现：`a185d58e41152fd440d9cdeced83ef58e1c7660d`。Harness：`0.1.3-alpha.1`，源码 `d347e703908d0406b7a7ef80e3a0e594d86b2215`，干净。环境：macOS、Node `v24.16.0`。产品 dirty 为 true，因为同时有文档任务；可执行 pilot 文件已提交，实验前后实现 fingerprint 一致。本轮没有改变 DSH core 源码、任务库、grader、工具 schema、prompt 或 proposer。

- Fixture hash：`a22ce6aca549d8d2506fff551f1a916bc5949aa5f913b74ce22319124665b2b6`。
- Implementation hash：`d9bae589c54a9e31186725e6203953f131520eee46f8c4999410ba5b44f9b478`。
- Plan hash：`b6452cff642db68e1240e0f58926fa3b4e5bd3871208e37decafe193987bc147`。
- 调度 seed：17；precondition baseline/treatment、batch treatment/baseline、format baseline/treatment。

## 实际结果

六个 arm 均为 `status=budget`、`goalReached=false`、`success=false`，每个 arm 准入四次模型请求。没有 infrastructure/invalid pair：计划三组、有效三组，全部双方失败，描述性成功率差为零。零对零是地板效应，不证明等效性或策略价值。

| 任务         | Baseline 调用 / 失败 | Treatment 调用 / 失败 | Baseline input / output tokens | Treatment input / output tokens |
| :----------- | -------------------: | --------------------: | -----------------------------: | ------------------------------: |
| Precondition |                6 / 4 |                 4 / 0 |                    2,593 / 402 |                     2,626 / 277 |
| Batch        |                6 / 0 |                 4 / 1 |                    2,740 / 500 |                     2,804 / 321 |
| Format       |                4 / 0 |                 5 / 1 |                    2,394 / 304 |                     2,872 / 362 |

合计 24 次付费请求、24 份 usage，**16,029 input tokens（含缓存）和 2,166 output tokens**。预留为 61,956 保守 input 字节单位和 12,288 output tokens，未超过 98,304 input 上限，达到 24 请求上限。Driver 耗时之和为 25,080 ms，不是实验总 wall time 或纯 provider 延迟。不根据 token 数推断实际货币成本。

全部 pair 通过首次 adapter options 和真实 wire 比较（仅移除 promoted guidance），以及初始状态、accepted seed、guidance 一致性检查。Baseline 不包含指导，treatment 在真实请求和规范 Session history 中包含指导。每个 arm 都完成 audit 隐私和工具销毁断言（`validationCompleted=true`），包括 Evolver audit 不含凭据。没有被禁止的网络尝试，获准官方请求另计如上。子进程退出后清理临时 Session、journal 和 workspace。安全报告不保留原始工具参数、模型输出或凭据。

Live 前通过 50 项 Vitest、10 项 Node 单元检查、全部八种原 benchmark 回归、真实 Headless 生命周期/恢复、随附 Web 启动、既有 DeepSeek 离线生命周期/故障场景，以及新真实 adapter fixture/429/hang 检查。格式、lint、typecheck、build、打包 dry-run、构建后 ESM import 和 diff 检查也通过。新 fixture 证明同一串行 wire 账本覆盖六个子进程；其 usage 是合成值，不是 live 证据。

## 解释和下一步决策

工具失败更少不代表任务完成：部分 arm 没有工具失败，却未达到精确状态目标。聚合计数无法区分过度 inspect、写入不完整、值错误或其他模型选择。原始 transcript 有意不保留，因此本轮不能支持更具体根因。不要静默扩大预算或修改任务协议后，把重跑称为同一实验。

下一步在单独版本中增加隐私安全诊断：inspect/commit/unknown-action 次数、有界验证错误类别、每次获准调用后的目标状态匹配，以及精确预算停止原因。先在离线和 development fixture 验证。审查最小工具 schema 是否充分表达协议；任何 schema/prompt 修改都需新版本、两组同改、冻结计划并另行约定付费预算。保留原负向 pilot。在任务基本可行性建立前，不付费扩大 heldout 重复；后续效果结论需要更广冻结样本和不确定性分析。本轮不建立服务端取消、多 runtime 一致性或通用自我演进效果。
