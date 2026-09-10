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

| 变更边界                          | 追加命令                          | 能证明什么                                                                  |
| :-------------------------------- | :-------------------------------- | :-------------------------------------------------------------------------- |
| Loader、命令、Session、注入、销毁 | `pnpm run test:runtime`           | 随附 Headless 生命周期/恢复和独立 Web 启动                                  |
| Smoke 适配器、wire 预算、传输     | `pnpm run test:deepseek-offline`  | 真实 DeepSeek 适配器的本地 SSE、429 和超时处理                              |
| Benchmark 评分、调度、完整性      | `pnpm run test:benchmark`         | 成功、失败、污染和超时的正确归类                                            |
| Benchmark 适配器和共享 wire 账本  | `pnpm run test:benchmark-adapter` | 真实适配器 fixture、传输故障和付费 CLI 拒绝边界                             |
| 配对测量输出                      | `pnpm run benchmark:offline`      | 脚本 baseline/treatment 报告和 guidance 开销                                |
| 包内容、exports、npm 分发         | `pnpm run test:package`           | 真实归档安装、ESM 和消费端类型；追加 `--runtime` 验证固定源码的随附 profile |

持久化修改还需覆盖重启、损坏/旧日志重放、状态转换、幂等性和相关准入竞争。模型可见变更需断言规范 Session 和实际请求。脚本 fixture 验证接线和评分；任务效果结论需要单独设计实验。

## 依赖升级策略

`package.json` 是兼容性唯一事实源：所有 DSH 开发包（包括其 peer 服务闭包）固定为同一个精确版本。DSH peer 范围限于该基线的 patch 发布线，显式纳入已测试的预发布版本并排除下一发布线。还需验证实际解析的依赖/peer 闭包，不能让一致的顶层掩盖更新的嵌套包。不要推定不同 pre-1.0 发布之间兼容。Cordis 和 Schemastery 保持独立范围；Evolver 自身版本跟随自身变更，不跟随宿主版本号。

升级候选来自 `npm view @deepseek-ai/dsh version`（CLI 的 `latest` 渠道），而非单个服务包或 `next`。将匹配的官方 release tag 解析到精确 commit，同步更新 [harness-source.json](../scripts/harness-source.json)、全部 DSH 开发 pin 和 peer 范围；兼容性门禁要求它们一致。然后运行 `pnpm install`，审查锁文件及精确版本的 `minimumReleaseAgeExclude` 条目，不全局关闭发布年龄保护。接受新发布线之前，运行 `pnpm run check:compatibility`、`pnpm peers check`、基础门禁和全部离线 runtime、adapter、benchmark 与 experience 门禁（`pnpm run test:experience`）。兼容性检查也包含在 `pnpm test` 中；集成启动器在启动前拒绝不支持或混合版本的宿主。这些命令只写本地依赖、构建和临时测试证据，不远端发布，也无需 provider 凭据。保留历史实验版本和结果；依赖升级不授权付费重跑。

## 准备宿主

集成门禁前运行 `pnpm run prepare:harness`。它将固定的官方 tag 克隆到 ignored 的 `.cache/harness/<commit>`，检查精确 commit、CLI 版本和干净源码，禁用 lifecycle scripts 安装锁定依赖，再构建 public host/client exports、Web 资产和 native addon。前置条件为 Node.js 24、pnpm 11 和宿主原生构建工具链；该操作下载源码/依赖，只写本地测试产物，不推进 pin、不移动开发 checkout、不调用模型或发布。源码缺失或被修改时直接失败，不自动 reset。

复用已有 Git 对象可运行 `pnpm run prepare:harness --source=../deepseek-harness`，前提是其中已有固定 commit。`pnpm run prepare:harness --check` 只检查源码身份，不证明构建新鲜度。集成门禁默认使用固定源码宿主，而非相邻 checkout 当前分支。全部 DSH/Cordis 服务通过其公开 exports 解析，不使用私有 import 或混合服务版本。

显式选择其他已构建宿主时，使用 CLI 路径或 `DSH_TEST_HARNESS`；回归子进程在清洗后的环境中转发该路径。优先级为 CLI、环境变量、已验证的源码 pin。`pnpm run test:package --runtime` 针对所选宿主验证归档；`--harness=PATH` 是 package 的显式覆盖。两者都不传时仅验证安装/exports。语法参见各 runner 的 `--help`。收集证据前实时检查产品/宿主 SHA 和 dirty state；旧运行不能验证不同 checkout。

## 运行时验收契约

运行时门禁启动随附 Headless profile，使用真实 Agent、工具、命令和持久 Session，配合脚本模型适配器与无害 probe。检查失败聚合、pending/accepted guidance 排除、人工提升、新 Session 的规范和请求可见 guidance、仅 exposure 进入 treatment、回滚、独立进程恢复、隐私 sentinel 和销毁。Web 只覆盖非交互 profile 启动，不覆盖浏览器或 WebSocket。

每个子进程使用临时 home、workspace 和状态，清洗环境并禁用生产工具、telemetry 和重试。外部网络被阻断，尝试联网会使断言失败。这些控制基于可信插件，不是 OS sandbox。运行时门禁每个子进程最多 20 请求、含 teardown 共 60 秒。成功要求显式销毁后自然退出；超时终止判为失败。成功或失败后都清理临时文件。

## 证据与未解决边界

每次新运行记录命令、环境、产品/宿主精确修订和 dirty state、断言及安全摘要。临时原始报告放在产品跟踪文档之外。只有会改变设计决策或影响实验解释的结果才保留带日期记录；不要在本指南累积通过测试清单。

Exposure 持久性、跨 runtime 新鲜度和 provider 关闭约束统一见[架构](architecture.zh.md)。真实 provider 认证和 streaming 验证使用单独授权的 [DeepSeek smoke](deepseek-smoke.zh.md)，任务成功测量使用[配对 benchmark](paired-benchmark.zh.md)。
