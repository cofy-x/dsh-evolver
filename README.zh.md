# DSH Evolver

[English](README.md) | [简体中文](README.zh.md)

**面向 DeepSeek Harness、可审计且由验证器把关的自我演进。**

> [!WARNING]
>
> 状态：早期开发和实验阶段。DSH Evolver 生成可供审查的策略提案，不会自主修改 DSH、插件或用户源码。

DSH Evolver 将 Agent 执行中有边界的事实转化为可复用策略指导，并经过显式验证、人工审查和提升。与普通记忆不同，收集到的失败不会立即影响后续请求；与技能库不同，候选策略在生效前始终关联来源以及可审计的生命周期。

```text
DSH 事件
  -> observation（观察）
  -> 精确失败模式
  -> 提案准入
  -> proposal（提案）
  -> 验证
  -> 人工审查
  -> 提升或拒绝
  -> baseline/treatment 评估
  -> 保留或人工回滚
```

## 最小示例

将 Git 仓库安装到一个 DSH profile，然后重启该 profile：

```sh
dsh plugin --profile web add github:cofy-x/dsh-evolver
dsh --profile web --dump-config
```

模型请求的工具失败后，通过支持命令的 DSH 客户端检查并审查生成的提案：

```text
/evolve list
/evolve patterns
/evolve pattern <pattern-id>
/evolve show <proposal-id>
/evolve accept <proposal-id>
/evolve promote <proposal-id>
/evolve evaluate <proposal-id>
```

拒绝候选使用 `/evolve reject <proposal-id> <reason>`。接受和提升有意分开。被提升的策略只会在之后的 Agent Session 启动时，通过 DSH 已有且有日志记录的 `agent.inject()` 路径注入。如果测量结果退化或操作员决定撤回策略，`/evolve rollback <proposal-id> <reason>` 会记录该决定并停止后续注入，但不会抹除历史。

## 工作方式

插件通过 `ctx.evolver` 提供服务，将工具失败记录为脱敏 observation，按精确签名聚合为 pattern，并生成经过离线结构安全验证的策略提案。人工接受并提升后，策略通过有日志的 `agent.inject()` 进入后续新 Session。

提升策略的效果按 baseline/treatment 工具失败率提供参考，回滚由人工决定。当前使用固定诊断模板，任务成功率提升尚未得到证明。状态机、持久化和一致性限制见[架构](docs/architecture.zh.md)。

## 安全模型

- 默认输出是提案，绝不是源码修改或命令执行。
- 只实现有边界的策略指导；禁止演进 evaluator、verifier、审批和安全策略。
- 确定性验证通过后才能人工接受，显式接受后才能提升。
- 模型只通过 DSH 规范且有日志的消息接收已提升策略。
- 收集器不保存完整 transcript、推理、工具参数、凭据或完整工具输出。
- MVP 离线运行，不连接外部网络。
- 效果事实仅包含元数据并受固定实验窗口限制，不能自动改变生命周期状态。
- Cordis 拥有所有注册；销毁会移除贡献并排空已经准入的写入。

## 安装

开发和 Git 安装需要 Node.js 24 或更新版本以及 pnpm 11。npm 候选使用 `alpha` 渠道；归档验证与发布流程见 [npm 发布](docs/releasing.zh.md)。首个 registry 版本验证完成前，使用上面的 Git 安装方式。可用后通过 `dsh plugin --profile web add dsh-evolver@alpha` 安装并重启 profile。发布归档包含已构建的 JavaScript 和类型声明，使用者不需要构建 Evolver。宿主兼容范围声明在 `package.json` 中。

```sh
git clone https://github.com/cofy-x/dsh-evolver.git
cd dsh-evolver
pnpm install --frozen-lockfile
pnpm run build
```

随附的 `cordis.patch.yml` 会在选定的 Web 或 Headless profile 中插入一个可选的 `dsh-evolver` 条目。配置支持 `dataDir`、`maxEvidenceChars`、`maxPromotedStrategies`、`evaluationWindowSize`（默认 20）、`minimumEvaluationSamples`（默认 5）、`regressionThreshold`（默认 0.15）、`reproposalAfterOccurrences`（默认 5，最大 1000）和 `generationReservationTimeoutMs`（默认 300000，最大 86400000）；无效或不安全边界会导致插件加载失败。

## 数据和隐私

存储包含 Session 和 call 标识符、工具名、采样的成功/失败结果、错误码、有边界且脱敏的摘要、提案文本、验证证据、exposure 记录、聚合评估投影和生命周期事实。没有收集 baseline/treatment 窗口的成功结果会被丢弃。存储不会保留工具参数、成功返回值、返回内容或重复的规范 DSH Session 事件。常见凭据、URL 和用户主目录前缀在持久化前会脱敏，但操作员仍应将 owner-only 审计文件视为可能敏感的诊断数据。

## 开发

开发命令以 [package scripts](package.json) 为准。按改动边界选择[验证门禁](docs/runtime-validation.zh.md)，贡献规则见 [AGENTS.md](AGENTS.md)。架构、付费 smoke 和配对实验入口见[文档索引](docs/README.zh.md)。

## 先前工作与致谢

`dsh-evolver` 是可审计 Agent 自我演进的独立 DSH 原生实现。其设计部分受到 [EvoMap/evolver](https://github.com/EvoMap/evolver) 以及更广泛的经验驱动 Agent 演进研究启发。本项目不隶属于 EvoMap，也未获得其背书；实现未使用 EvoMap 源码、提示词、私有格式，也不声称协议兼容。

## 运行限制

每个数据目录只使用一个活动 runtime。提升和回滚只影响后续新 Session；exposure 持久化与 Session 写入尚不具备跨存储原子性。产品保持离线，外部验证器、LLM 提案生成和代码演进尚未实现。扩展前置条件见[架构](docs/architecture.zh.md)。

## 许可证

[MIT](LICENSE)。
