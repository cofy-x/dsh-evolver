# npm release

[English](releasing.md) | [简体中文](releasing.zh.md) | [Documentation map](README.md)

## Contract

Publish alpha candidates explicitly with the `alpha` dist-tag. Leave the existing `latest` tag untouched; it is not the recommended installation channel. Evolver versions are independent of Harness. Publication requires explicit authorization, a clean synchronized `main`, successful required CI and an immutable annotated `v<package-version>` tag. Git objects are pushed only through Hangar's devbox-x workflow. A tag never publishes automatically; never move a pushed tag or reuse a published version.

## Candidate

Use Node.js 24, pnpm 11 and locked dependencies. Complete the [standard and boundary gates](runtime-validation.md), then run `pnpm run test:package --runtime` after `pnpm run prepare:harness`. This builds and packs Evolver, installs the real archive with public peers in a temporary npm consumer, checks ESM/types and runs shipped Headless lifecycle/recovery and Web startup. Downloads use public npm with lifecycle scripts disabled; runtime checks block outbound network and use no provider credentials.

The consumer is removed; archive and SHA-512 report remain under ignored `.cache/release/`. Without `--runtime` or an explicit `--harness=PATH`, the gate checks distribution and exports only, not shipped profiles.

After commit, synchronization and required CI, obtain tag authorization and use Hangar's release runbook. Refresh tracking refs through that workflow, run `node scripts/check-release.mjs`, regenerate the archive from the clean candidate, then run `node scripts/check-release.mjs --artifact`. These read-only checks require candidate identity with `origin/main`, the annotated tag and matching archive version/integrity. Never publish a dirty-tree report or rebuild between verification and publication.

## Staging and approval

The [manual release workflow](../.github/workflows/release.yml) runs from `main` against an existing annotated alpha tag. It checks candidate identity and that commit's successful `ci.yml` push run, reruns checks and uploads `npm-candidate`. Default `stage=false` writes nothing to npm. Explicitly authorized `stage=true` submits the verified archive to staging; it does not publish it publicly. CI does not replace local shipped-profile acceptance.

Prerequisites are the GitHub `npm` environment and npm trusted-publisher mapping for owner `cofy-x`, repository `dsh-evolver`, workflow `release.yml`, environment `npm`, with stage-only permission. Use GitHub-hosted runners, protected release refs and human approval controls. Keep long-lived npm tokens out of repository secrets. A successful non-staging run does not prove OIDC staging works.

Review the staged version and integrity against the workflow artifact, then approve on npm with 2FA. Never automatically approve or fall back to tokens/direct publication when OIDC fails. A failed tagged candidate requires a new commit/version/tag; preserve failure evidence.

## Registry verification

After approval, compare `npm view dsh-evolver@<version> version dist.integrity --json --registry=https://registry.npmjs.org/` with the artifact report, then inspect `npm view dsh-evolver dist-tags --json --registry=https://registry.npmjs.org/`. Verify `alpha` and install the exact registry version in a disposable DSH profile. Do not unpublish/reuse a failed version or remove `latest`. GitHub Releases are optional and separately authorized.

Official references: [trusted publishers](https://docs.npmjs.com/trusted-publishers/), [staged publishing](https://docs.npmjs.com/staged-publishing/), [npm stage CLI](https://docs.npmjs.com/cli/v11/commands/npm-stage/).
