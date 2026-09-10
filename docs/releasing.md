# npm release

[English](releasing.md) | [简体中文](releasing.zh.md) | [Documentation map](README.md)

## Contract

The package is `dsh-evolver`; alpha versions use the `alpha` dist-tag, never `latest`. Keep Evolver's version independent of Harness. Releases require explicit authorization, a clean synchronized `main` commit, successful required CI, and an immutable annotated `v<package-version>` tag. Git objects are pushed only through Hangar's devbox-x remote-sync/tag workflow. A tag does not publish anything automatically. Do not move a pushed tag or overwrite a version.

## Build and verify a candidate

Use Node.js 24, pnpm 11 and locked dependencies. Follow [standard and boundary-specific verification](runtime-validation.md). From this checkout, run `pnpm run test:package --harness=../deepseek-harness` after preparing the sibling host. It builds once, packs a real archive, installs it with public host peers into a fresh temporary npm consumer, checks ESM and TypeScript exports, then exercises the archive through shipped Headless lifecycle/recovery and Web startup. Installation downloads public npm dependencies with lifecycle scripts disabled; runtime validation blocks outbound network and uses no provider credentials. The temporary consumer is removed; the archive and SHA-512 integrity report remain under ignored `.cache/release/`. Without `--harness`, CI checks archive installation and exports only, not shipped-profile integration.

After commit, sync and required CI success, obtain explicit tag authorization and use the Hangar release runbook to push the annotated version tag via devbox-x. Run `node scripts/check-release.mjs`, regenerate the candidate from the clean commit, then run `node scripts/check-release.mjs --artifact`. These checks are read-only: they require the candidate to equal `origin/main`, validate the tag, and verify artifact identity, version and integrity against the report. Never publish a dirty-tree report or rebuild between artifact verification and publication. Local tracking refs must first be refreshed by the synchronization workflow.

## First publication: interactive bootstrap

An npm account with verified email and 2FA is required. A new package cannot use trusted or staged publishing until it exists on npm. Do not publish a placeholder. After the candidate and tag gates pass, the maintainer runs `npm login --registry=https://registry.npmjs.org/` in their own terminal and completes browser/2FA authentication without sharing secrets. With explicit publication approval, publish the exact verified archive using `npm publish .cache/release/dsh-evolver-<version>.tgz --ignore-scripts --access public --tag alpha --registry=https://registry.npmjs.org/`, substituting the verified version. This is an external, irreversible version publication, not a dry-run. Do not claim CI provenance for this local bootstrap.

Confirm `npm view dsh-evolver@<version> version dist.integrity --json --registry=https://registry.npmjs.org/` matches the local report, and check `npm view dsh-evolver dist-tags --json --registry=https://registry.npmjs.org/`. Install the registry version into a disposable DSH profile before declaring distribution complete. Do not unpublish/reuse a failed version; diagnose and issue a new alpha version.

## Subsequent releases: OIDC staging and human approval

Create a GitHub environment named `npm`, configure an approval reviewer where available, and restrict deployment to the intended release refs. Configure npm Settings → Trusted publishing for GitHub Actions: owner `cofy-x`, repository `dsh-evolver`, workflow filename `release.yml`, environment `npm`; grant stage-only permission. Then select “Require two-factor authentication and disallow tokens” in publishing access. Do not create a long-lived `NPM_TOKEN` secret. Review workflow changes and protect `main` and release tags. GitHub-hosted runners are required for this OIDC path.

The manually dispatched `release.yml` runs from `main` with an existing annotated alpha tag input. It checks candidate identity and that commit's successful `ci.yml` push run, reruns standard checks, and uploads the tested archive/report as `npm-candidate`. Default `stage=false` performs no npm write; after bootstrap and trusted-publisher setup, explicitly select `stage=true` to submit that exact archive to npm staging. The workflow pins npm CLI separately from the pnpm development toolchain and never calls direct `npm publish`. This workflow does not replace the local shipped-profile gate.

Review the staged package on npm, compare its version and archive integrity with the workflow artifact, then approve with 2FA to make it public. A staged submission is not yet a release. Verify registry integrity and `alpha` after approval. Never automatically approve or fall back to token-based/direct publication when OIDC fails. A failed tagged candidate requires a new commit/version/tag; retain failure evidence. GitHub Releases are optional and separately authorized.

Official references: [trusted publishers](https://docs.npmjs.com/trusted-publishers/), [staged publishing](https://docs.npmjs.com/staged-publishing/), [npm stage CLI](https://docs.npmjs.com/cli/v11/commands/npm-stage/).
