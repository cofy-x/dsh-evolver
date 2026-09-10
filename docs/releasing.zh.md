# npm 发布

[English](releasing.md) | [简体中文](releasing.zh.md) | [文档地图](README.zh.md)

## 契约

Alpha 候选显式使用 `alpha` dist-tag 发布。保持现有 `latest` 不动；它不是推荐安装渠道。Evolver 版本独立于 Harness。发布需要显式授权、干净且同步的 `main`、必需 CI 成功，以及不可变 annotated `v<package-version>` tag。Git 对象仅通过 Hangar 的 devbox-x 工作流推送。Tag 不自动发布；不得移动已推送 tag 或复用已发布版本。

## 候选包

使用 Node.js 24、pnpm 11 和锁定依赖。完成[标准与边界门禁](runtime-validation.zh.md) 后，先运行 `pnpm run prepare:harness`，再运行 `pnpm run test:package --runtime`。该命令构建并打包 Evolver，在临时 npm consumer 中安装真实归档与公开 peers，检查 ESM/类型，再运行 shipped Headless 生命周期/恢复与 Web 启动。下载使用公开 npm，禁用 lifecycle scripts；runtime 验证阻断外网，不使用提供方凭据。

Consumer 会被清理；归档和 SHA-512 报告保留于 ignored 的 `.cache/release/`。不传 `--runtime` 或显式 `--harness=PATH` 时只检查分发和 exports，不验证 shipped profile。

Commit、同步和必需 CI 完成后，获取 tag 授权并使用 Hangar release runbook。通过该流程刷新 tracking refs，运行 `node scripts/check-release.mjs`，从干净候选重新生成归档，再运行 `node scripts/check-release.mjs --artifact`。这些只读检查要求候选与 `origin/main` 一致、annotated tag 有效、归档版本/完整性匹配。不得发布 dirty-tree 报告，验证与发布之间不得重新构建。

## 暂存与批准

[手动 release workflow](../.github/workflows/release.yml) 从 `main` 针对已有 annotated alpha tag 运行。它检查候选身份及该 commit 成功的 `ci.yml` push run，重新验证并上传 `npm-candidate`。默认 `stage=false` 不写 npm。显式授权的 `stage=true` 将已验证归档提交暂存，不会公开发布。CI 不替代本地 shipped-profile 验收。

前置条件是 GitHub `npm` environment，以及 npm trusted-publisher 映射：owner `cofy-x`、repository `dsh-evolver`、workflow `release.yml`、environment `npm`，权限为 stage-only。使用 GitHub-hosted runner、受保护 release refs 和人工批准控制。仓库 secrets 不保存长期 npm token。非暂存运行成功不证明 OIDC 暂存可用。

对照 workflow artifact 审查暂存版本和完整性，然后在 npm 使用 2FA 批准。不得自动批准，也不得在 OIDC 失败后回退到 token/直接发布。失败的已打 tag 候选需要新 commit/version/tag，并保留失败证据。

## Registry 验证

批准后，将 `npm view dsh-evolver@<version> version dist.integrity --json --registry=https://registry.npmjs.org/` 与 artifact 报告对比，再检查 `npm view dsh-evolver dist-tags --json --registry=https://registry.npmjs.org/`。确认 `alpha`，并在一次性 DSH profile 中安装精确 registry 版本。不得 unpublish/复用失败版本，也不删除 `latest`。GitHub Release 是可选且需单独授权的操作。

官方参考：[trusted publishers](https://docs.npmjs.com/trusted-publishers/)、[staged publishing](https://docs.npmjs.com/staged-publishing/)、[npm stage CLI](https://docs.npmjs.com/cli/v11/commands/npm-stage/)。
