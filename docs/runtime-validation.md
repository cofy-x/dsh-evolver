# Verification

[English](runtime-validation.md) | [简体中文](runtime-validation.zh.md) | [Documentation map](README.md)

## Select a gate

Run commands from the product checkout with Node.js 24 or newer, pnpm 11, and installed locked dependencies. Code changes require the standard checks below; documentation-only changes require formatting, relative-link checks, and staged/unstaged diff review.

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

| Changed boundary                                | Additional command                | What it establishes                                                                                             |
| :---------------------------------------------- | :-------------------------------- | :-------------------------------------------------------------------------------------------------------------- |
| Loader, commands, Sessions, injection, disposal | `pnpm run test:runtime`           | Shipped Headless lifecycle/recovery and separate Web startup                                                    |
| Smoke adapter, wire budgets, transport          | `pnpm run test:deepseek-offline`  | Real DeepSeek adapter with local SSE, 429 and timeout handling                                                  |
| Benchmark grading, scheduling, integrity        | `pnpm run test:benchmark`         | Correct scoring of success, failure, contamination and timeouts                                                 |
| Benchmark adapter and shared wire ledger        | `pnpm run test:benchmark-adapter` | Real-adapter fixture, transport faults and paid CLI rejection                                                   |
| Paired measurement output                       | `pnpm run benchmark:offline`      | Scripted baseline/treatment report and guidance overhead                                                        |
| Package contents, exports, npm distribution     | `pnpm run test:package`           | Real archive installation, ESM and consumer types; add `--runtime` for pinned-source shipped-profile acceptance |

Persistence changes also require restart, corrupt/legacy replay, transitions, idempotency, and relevant admission-race tests. Model-visible changes require canonical Session and actual-request assertions. Scripted fixtures establish wiring and grading; task-effectiveness claims need a separately designed experiment.

## Dependency upgrade policy

`package.json` is the compatibility source of truth: pin all DSH development packages, including their peer-service closure, to one exact release. Limit DSH peer ranges to that baseline's patch release line, explicitly admitting the tested prerelease and excluding the next line. Validate the resolved dependency/peer closure too: a coherent top level must not hide newer nested packages. Do not infer compatibility across pre-1.0 releases. Cordis and Schemastery keep their independent ranges; Evolver's own version follows Evolver changes, not the host's release number.

Select an upgrade from `npm view @deepseek-ai/dsh version` (the CLI's `latest` channel), not an individual service package or `next`. Resolve the matching official release tag to an exact commit and update [harness-source.json](../scripts/harness-source.json) together with all DSH development pins and peer ranges; the compatibility gate requires their agreement. Then run `pnpm install`, and review the lockfile and any exact-version `minimumReleaseAgeExclude` entries; do not disable release-age protection globally. Run `pnpm run check:compatibility` and `pnpm peers check`, the standard gates, and all offline runtime, adapter, benchmark and experience gates (`pnpm run test:experience`) before accepting a new line. The compatibility check is also part of `pnpm test`; integration launchers reject unsupported or mixed host releases before boot. These commands write local dependencies/builds and temporary test evidence, not remote releases, and need no provider credentials. Preserve historical experiment versions and results; a dependency upgrade does not authorize paid reruns.

## Prepare the host

Run `pnpm run prepare:harness` before integration gates. It clones the pinned official tag into ignored `.cache/harness/<commit>`, checks the exact commit, CLI version and clean source, installs locked dependencies with lifecycle scripts disabled, then builds public host/client exports, Web assets and the native addon. Node.js 24, pnpm 11 and the host's native build toolchain are prerequisites; this downloads source/dependencies and writes only local test artifacts. It never advances the pin, moves a developer checkout, calls a model or publishes anything. Missing or edited source fails instead of being reset.

To reuse existing Git objects, use `pnpm run prepare:harness --source=../deepseek-harness`; the pinned commit must already exist there. `pnpm run prepare:harness --check` checks source identity only, not build freshness. Integration gates default to this pinned source host, not the sibling's current branch. Resolve all DSH/Cordis services through its public exports; no private imports or mixed service versions.

An explicitly selected alternate built host uses CLI paths or `DSH_TEST_HARNESS`; regression subprocesses forward that path in the scrubbed environment. CLI takes precedence over the variable, then the verified source pin. `pnpm run test:package --runtime` tests the archive against the selected host; `--harness=PATH` is the explicit package override. Without either option, package acceptance checks installation/exports only. Consult each runner's `--help` for syntax. Check the live host/product SHAs and dirty state before collecting evidence; a previous run does not validate a different checkout.

## Runtime acceptance contract

The runtime gate boots the shipped Headless profile with real Agents, tools, commands and persisted Sessions, a scripted model adapter, and a harmless probe. It checks failure aggregation; pending/accepted guidance exclusion; human promotion; canonical and request-visible guidance in a fresh Session; exposure-only treatment; rollback; separate-process recovery; privacy sentinels; and disposal. Web coverage is a noninteractive shipped-profile startup smoke, not browser or WebSocket coverage.

Each child uses temporary homes, workspace and state, a scrubbed environment, and disabled production tools, telemetry and retries. Outbound network is blocked and attempts fail assertions. These controls assume trusted plugins; they are not an OS sandbox. The runtime gate limits each child to 20 requests and 60 seconds including teardown. Success requires natural exit after explicit disposal; deadline termination is failure. Temporary files are cleaned after either outcome.

## Evidence and unresolved boundaries

Record the command, environment, exact product/host revisions and dirty state, assertions and safe summary for a new run. Keep raw transient reports outside tracked product documentation. Retain a dated result only when it changes a design decision or is needed to interpret an experiment; do not add passing-test inventories to this guide.

Exposure durability, cross-runtime freshness and provider shutdown constraints live in [architecture](architecture.md). Real-provider authentication and streaming checks use the separately authorized [DeepSeek smoke](deepseek-smoke.md); task-success measurement uses the [paired benchmark](paired-benchmark.md).
