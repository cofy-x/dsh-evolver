# 验证指南

[English](runtime-validation.md) | [简体中文](runtime-validation.zh.md) | [文档索引](README.zh.md)

## 选择门禁

从产品 checkout 执行命令，使用 Node.js 24 或更新版本、pnpm 11 和已按锁文件安装的依赖。代码修改执行以下基础检查；纯文档修改检查格式、相对链接以及 staged/unstaged diff。

```sh
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
pnpm pack --dry-run
git diff --check
git diff --cached --check
```

| 变更边界                          | 追加命令                          | 能证明什么                                      |
| :-------------------------------- | :-------------------------------- | :---------------------------------------------- |
| Loader、命令、Session、注入、销毁 | `pnpm run test:runtime`           | 随附 Headless 生命周期/恢复和独立 Web 启动      |
| Smoke 适配器、wire 预算、传输     | `pnpm run test:deepseek-offline`  | 真实 DeepSeek 适配器的本地 SSE、429 和超时处理  |
| Benchmark 评分、调度、完整性      | `pnpm run test:benchmark`         | 成功、失败、污染和超时的正确归类                |
| Benchmark 适配器和共享 wire 账本  | `pnpm run test:benchmark-adapter` | 真实适配器 fixture、传输故障和付费 CLI 拒绝边界 |
| 配对测量输出                      | `pnpm run benchmark:offline`      | 脚本 baseline/treatment 报告和 guidance 开销    |

持久化修改还需覆盖重启、损坏/旧日志重放、状态转换、幂等性和相关准入竞争。模型可见变更需断言规范 Session 和实际请求。脚本 fixture 验证接线和评分；任务效果结论需要单独设计实验。

## 依赖升级策略

`package.json` 是兼容性唯一事实源：所有 DSH 开发包（包括其 peer 服务闭包）固定为同一个精确版本。DSH peer 范围限于该基线的 patch 发布线，显式纳入已测试的预发布版本并排除下一发布线。不要推定不同 pre-1.0 发布之间兼容。Cordis 和 Schemastery 保持独立范围；Evolver 自身版本跟随自身变更，不跟随宿主版本号。

升级时一起更新所有 DSH 开发依赖和 peer 范围，运行 `pnpm install`，审查锁文件及精确版本的 `minimumReleaseAgeExclude` 条目，不全局关闭发布年龄保护。接受新发布线之前，运行 `pnpm run check:compatibility`、`pnpm peers check`、基础门禁和全部离线 runtime、adapter、benchmark 与 experience 门禁（`pnpm run test:experience`）。兼容性检查也包含在 `pnpm test` 中；集成启动器在启动前拒绝不支持或混合版本的宿主。这些命令只写本地依赖、构建和临时测试证据，不远端发布，也无需 provider 凭据。保留历史实验版本和结果；依赖升级不授权付费重跑。

## 准备宿主

集成命令会构建 Evolver，默认使用相邻 `../deepseek-harness`。遵循宿主自身开发说明安装依赖并构建公共 exports 和 Web 资产。缺失或过期构建会直接失败，没有 fixture fallback。全部 DSH/Cordis 服务应统一通过宿主公共 exports 解析，不使用私有源码 import，也不混用发布/workspace 服务版本。

使用其他宿主路径时先构建 Evolver，再查阅 `node scripts/runtime-e2e.mjs --help` 或 `node scripts/benchmark.mjs --help`。收集证据前实时检查产品/宿主 SHA 和 dirty state；旧运行不能验证不同 checkout。

## 运行时验收契约

运行时门禁启动随附 Headless profile，使用真实 Agent、工具、命令和持久 Session，配合脚本模型适配器与无害 probe。检查失败聚合、pending/accepted guidance 排除、人工提升、新 Session 的规范和请求可见 guidance、仅 exposure 进入 treatment、回滚、独立进程恢复、隐私 sentinel 和销毁。Web 只覆盖非交互 profile 启动，不覆盖浏览器或 WebSocket。

每个子进程使用临时 home、workspace 和状态，清洗环境并禁用生产工具、telemetry 和重试。外部网络被阻断，尝试联网会使断言失败。这些控制基于可信插件，不是 OS sandbox。运行时门禁每个子进程最多 20 请求、含 teardown 共 60 秒。成功要求显式销毁后自然退出；超时终止判为失败。成功或失败后都清理临时文件。

## 证据与未解决边界

每次新运行记录命令、环境、产品/宿主精确修订和 dirty state、断言及安全摘要。临时原始报告放在产品跟踪文档之外。只有会改变设计决策或影响实验解释的结果才保留带日期记录；不要在本指南累积通过测试清单。

Exposure 持久性、跨 runtime 新鲜度和 provider 关闭约束统一见[架构](architecture.zh.md)。真实 provider 认证和 streaming 验证使用单独授权的 [DeepSeek smoke](deepseek-smoke.zh.md)，任务成功测量使用[配对 benchmark](paired-benchmark.zh.md)。
