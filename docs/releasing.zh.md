# npm 发布

[English](releasing.md) | [简体中文](releasing.zh.md) | [文档索引](README.zh.md)

## 契约

包名为 `dsh-evolver`；alpha 版本使用 `alpha` dist-tag，不使用 `latest`。Evolver 版本独立于 Harness。发布需要明确授权、干净且已同步的 `main` 精确 commit、required CI 成功，以及不可变的 annotated `v<package-version>` tag。Git 对象仅通过 Hangar 的 devbox-x remote-sync/tag 流程推送。推送 tag 不会自动发布。不得移动已推送 tag 或覆盖版本。

## 构建并验证候选

使用 Node.js 24、pnpm 11 和锁定依赖，遵循[基础与边界验证](runtime-validation.zh.md)。准备相邻宿主后，从本 checkout 执行 `pnpm run test:package --harness=../deepseek-harness`。该命令构建一次、生成真实归档，将其与公共宿主 peers 安装进全新的临时 npm 消费项目，检查 ESM 和 TypeScript exports，再通过随附 Headless 生命周期/恢复及 Web 启动验证归档。安装会下载公开 npm 依赖，禁用生命周期脚本；运行时验证阻断外部网络且无需 provider 凭据。临时消费项目会被清理；归档和 SHA-512 integrity 报告保留在 ignored `.cache/release/`。不带 `--harness` 时，CI 只检查归档安装和 exports，不覆盖随附 profile 集成。

提交、同步且 required CI 成功后，获得明确 tag 授权，按 Hangar release runbook 经 devbox-x 推送 annotated 版本 tag。运行 `node scripts/check-release.mjs`，从干净 commit 重新生成候选，然后运行 `node scripts/check-release.mjs --artifact`。这些检查只读：要求候选等于 `origin/main`，验证 tag，并将归档身份、版本和 integrity 与报告核对。不发布 dirty-tree 报告对应的包，不在归档验证与发布之间重新构建。本地 tracking refs 必须先通过同步流程刷新。

## 首次发布：交互式引导

npm 账号必须完成邮箱验证并开启 2FA。新包在 npm 上存在之前不能使用 trusted 或 staged publishing。不发布占位包。候选及 tag 门禁通过后，维护者在自己的终端运行 `npm login --registry=https://registry.npmjs.org/`，完成浏览器/2FA 认证，不分享秘密。获得明确发布批准后，使用 `npm publish .cache/release/dsh-evolver-<version>.tgz --ignore-scripts --access public --tag alpha --registry=https://registry.npmjs.org/` 发布已验证的精确归档，将占位符替换为已验证版本。这是外部、不可覆盖的版本发布，不是 dry-run。本地引导发布不宣称 CI provenance。

确认 `npm view dsh-evolver@<version> version dist.integrity --json --registry=https://registry.npmjs.org/` 与本地报告一致，并检查 `npm view dsh-evolver dist-tags --json --registry=https://registry.npmjs.org/`。将 registry 版本安装进一次性 DSH profile 后，才能宣告分发闭环。失败版本不通过 unpublish 重用；定位原因后发布新 alpha 版本。

## 后续发布：OIDC 暂存与人工批准

创建名为 `npm` 的 GitHub environment，在可用时配置审核人，并将部署限制为预期发布 refs。在 npm Settings → Trusted publishing 配置 GitHub Actions：owner `cofy-x`、repository `dsh-evolver`、workflow filename `release.yml`、environment `npm`，仅授权 stage。随后在 publishing access 选择 “Require two-factor authentication and disallow tokens”。不创建长期 `NPM_TOKEN` secret。审查 workflow 改动，保护 `main` 和发布 tag。此 OIDC 路径要求 GitHub-hosted runner。

手动从 `main` 触发 `release.yml`，输入已有 annotated alpha tag。它核对候选身份及该 commit 的 `ci.yml` push run 成功状态，重跑基础检查，并将验证后的归档/报告上传为 `npm-candidate`。默认 `stage=false` 不写 npm；完成首发与 trusted-publisher 配置后，显式选择 `stage=true` 才会把同一归档提交至 npm 暂存区。Workflow 单独固定 npm CLI，不改变 pnpm 开发工具链，绝不调用直接 `npm publish`。此 workflow 不替代本地随附 profile 门禁。

在 npm 审核 staged package，将版本与归档 integrity 对照 workflow artifact，再用 2FA 批准公开。提交暂存不等于发布完成。批准后核对 registry integrity 和 `alpha`。不自动批准，也不在 OIDC 失败时回退至 token/直接发布。已打 tag 的候选失败后必须使用新 commit/version/tag，保留失败证据。GitHub Release 可选且需单独授权。

官方参考：[trusted publishers](https://docs.npmjs.com/trusted-publishers/)、[staged publishing](https://docs.npmjs.com/staged-publishing/)、[npm stage CLI](https://docs.npmjs.com/cli/v11/commands/npm-stage/)。
