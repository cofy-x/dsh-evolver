# 可选 DeepSeek smoke runner

[English](deepseek-smoke.md) | [简体中文](deepseek-smoke.zh.md) | [文档索引](README.zh.md)

Runner 同时支持离线适配器检查和经明确授权的 live 执行。离线模式无需真实凭据或网络，仍会覆盖随附 DeepSeek 适配器、wire 序列化、SSE 解析和 usage 映射。

## 入口和前置条件

在产品 checkout 中，`node scripts/runtime-e2e.mjs --help` 是权威 CLI 参考。`pnpm run test:deepseek-offline` 会构建 Evolver，以本地 SSE 运行真实适配器，再验证 HTTP 429 和永不结束的 transport。它需要与[运行时验证](runtime-validation.zh.md)相同的已构建相邻 Harness 公共 exports，不需要 core 源码修改、私有测试辅助函数、网络或真实凭据。Runner 支持可选的 checkout 位置参数，package script 默认使用相邻 checkout。

Live 执行必须同时提供 `--deepseek-live --allow-paid --model=ID`，并事先在环境中提供 `DEEPSEEK_API_KEY`。执行前必须选择并确认实际 model ID。Runner 在读取该变量前先验证参数；不继承其他用户凭据、代理、endpoint override 或 Node options。不要把 key 字面量写入 shell history 或 profile YAML。授权无效或缺失会在 boot 前失败。本文不构成花费授权，必须先询问用户。

写入仅限临时 home/workspace、规范 Session 文件、Evolver audit、预算 ledger 和小型阶段报告，成功或失败后都会删除。Live 子进程 stdout/stderr 直接丢弃，不做尽力脱敏。父进程只接收结构化 pass/fail、model、分阶段 usage、累计 reservation、源码 SHA/dirty flag 和运行时版本。不会保留 transcript、原始 provider error 或凭据值。

## 共用场景，不同 provider 边界

默认仍是脚本 provider 加随附 Headless/Web 启动。DeepSeek 模式只运行相同 Headless 场景和独立重启：pending/accepted 请求排除、真实 accept/promote 命令、规范和 wire guidance、exposed/unexposed treatment、rollback、audit privacy、持久恢复和 disposal。每轮都会按合成契约断言真实 probe 调用和参数；模型提前停止、增加调用或忽略指令会失败，不能通过伪造事件补齐。

两种 DeepSeek 模式通过公共入口启用 `llm-deepseek`，所有 Agent 选择 `deepseek-official`。Effect-owned 的公共完整 system-prompt section 提供简短合成工具协议；这不是对默认编码 prompt 的完整测试。Credentials 服务解析调用者授权的环境 key 或明显的离线 fixture sentinel；dry-run 不读取真实 key。

适配器禁用 thinking/reasoning，每次最多 512 output tokens，stream idle timeout 15 秒，provider retry 为 `normal` 且 `maxRetries: 0`；外层 retry 插件也禁用。Session-log、本地包清单扩展以及生产工具、telemetry、标题生成 overlay 均禁用，只暴露无害 probe。Wire 准入拒绝未知扩展字段和非文本消息内容。

## 预算和网络边界

`budget.mjs` 是限制的唯一事实源：两个进程合计最多预留 16 次 HTTP 请求；每次 512 output tokens，总计 8,192；每次最多 4,096 input admission units，总计 32,768。请求在 transport 前同步计费，包括失败请求；恢复沿用同一临时 ledger，不能重置总额度。每次成功适配器调用必须恰好报告一条有效 usage，禁止隐藏或重试 HTTP 调用。超出单次或阶段 usage 会停止场景；跨阶段仍以预留总限制为准。

输入准入计算完整序列化 UTF-8 字节，再加 256 framing units 和每条消息 32 units。这是有余量的保守 byte-BPE 估算，不是已验证 provider tokenizer 或保证的 billing-token 上限。付费前必须与用户确认 tokenizer 假设和价格；若需要精确 billing 边界，应先集成对应 tokenizer。

只允许精确 POST 到 `https://api.deepseek.com/chat/completions`；拒绝自定义 endpoint、query string、redirect、文件和 model discovery。Dry-run 阻断 socket/TLS 并提供本地 SSE。Live 使用原生 fetch、请求取消 signal 和 15 秒 deadline，只允许固定 host/port 的 TLS，并阻断直接 HTTP(S) helper。这是可信随附插件上的应用级防护，不是 OS firewall；不暴露有网络或文件系统能力的工具。

父进程对启动、场景、恢复和 teardown 设 120 秒总上限，`--timeout-ms` 只能降低。原生 fetch 同时接收 Agent signal 及更早的 request/run deadline。卡死或忽略 abort 的子进程会被终止并判为失败，临时状态会删除；这不能证明外部 provider 已停止工作或计费。

## 验收和结论边界

新运行应通过共享生命周期、规范/wire guidance、恢复、隐私和销毁断言。离线 fixture 验证序列化、SSE、预算与故障处理；授权 live smoke 另外验证该次运行的认证、endpoint/model 兼容性及工具协议遵循。保留精确修订和安全摘要即可，不在此累积每次请求和 token 明细。

Smoke 不能证明策略提高任务成功率。相关实验契约和保留的负向结果见[配对 benchmark](paired-benchmark.zh.md)。
