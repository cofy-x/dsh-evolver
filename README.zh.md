# DSH Evolver

[English](README.md) | [简体中文](README.zh.md)

面向 DeepSeek Harness、可审计且经过验证门禁的策略演进。

DSH Evolver 将有界执行失败转化为可审查的策略提案。只有依次通过验证、人工接受和显式晋升，指导才会进入后续 Session。它不会自主修改 DSH、插件或用户代码。产品仍处于实验阶段：固定诊断模板和结构性验证器尚不能证明任务成功率提升。

## 使用

将已发布的 alpha 安装到 DSH profile，然后重启该 profile：

```sh
dsh plugin --profile web add dsh-evolver@alpha
dsh --profile web --dump-config
```

发布包包含构建后的 JavaScript 和类型声明。受支持的模块入口只有 `dsh-evolver`、`dsh-evolver/domain` 和 `dsh-evolver/store`；源码模块属于内部实现，不随包发布。如需精确候选，将 `alpha` 替换为已发布版本。[package.json](package.json) 声明开发基线与宿主兼容范围；registry 渠道可能仍指向较早版本。也可通过 `dsh plugin --profile web add github:cofy-x/dsh-evolver` 从 Git 安装，但需要开发工具链。

模型请求的工具失败后，在支持命令的 DSH 客户端中执行：

```text
/evolve list
/evolve patterns
/evolve pattern <pattern-id>
/evolve show <proposal-id>
/evolve accept <proposal-id>
/evolve promote <proposal-id>
/evolve evaluate <proposal-id>
```

接受与晋升是两个独立的人工决定。通过 `/evolve reject <proposal-id> <reason>` 拒绝候选；通过 `/evolve rollback <proposal-id> <reason>` 撤回生效指导。晋升和回滚只影响后续 Session，不抹除历史。

## 契约

离线插件提供 `ctx.evolver`，将脱敏失败归为精确签名模式，并管理提案代次。只有已晋升文本通过公开、留痕的 `agent.inject()` 进入模型上下文。评估比较曝光范围内的工具失败率，为人工判断提供证据，不自动回滚，也不证明因果关系。

审计仅存储有界诊断事实和 canonical Session 引用，不存储完整转录、推理、工具参数、凭据或完整工具输出。脱敏属于防御措施，不保证任意文本都不敏感；应保护仅所有者可读写的审计文件。每个数据目录只运行一个活跃 runtime。

配置以 [loader schema](src/config.ts) 为准。[profile patch](cordis.patch.yml) 向 Web 或 Headless profile 添加可选插件行。Evolver 不拥有模型凭据或工具权限，不能执行提案文本，也不能改写验证器、评估器、审批或安全策略。

## 开发与扩展

使用 Node.js 24 或更新版本及 pnpm 11：

```sh
git clone https://github.com/cofy-x/dsh-evolver.git
cd dsh-evolver
pnpm install --frozen-lockfile
pnpm run build
```

通过 `pnpm run prepare:harness` 构建已固定发布版本的 Harness 源码，供集成测试使用。遵守 [AGENTS.md](AGENTS.md) 和[验证指南](docs/runtime-validation.zh.md)。[文档地图](docs/README.zh.md) 指向架构、发布和实验流程。[架构](docs/architecture.zh.md) 定义未来优先级与扩展前提：先建立有用策略的证据，再增加提供方、自动化或存储复杂度。

## 先行工作与许可

本项目是独立的 MIT 许可、DSH 原生实现，部分设计受到 [EvoMap/evolver](https://github.com/EvoMap/evolver) 和经验驱动 Agent 演进研究的启发。项目不隶属于 EvoMap，也不获其背书；不以 EvoMap 源码、提示词或私有格式为实现输入，不宣称协议兼容。参见 [LICENSE](LICENSE)。
