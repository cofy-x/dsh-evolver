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

| Changed boundary                                | Additional command                | What it establishes                                             |
| :---------------------------------------------- | :-------------------------------- | :-------------------------------------------------------------- |
| Loader, commands, Sessions, injection, disposal | `pnpm run test:runtime`           | Shipped Headless lifecycle/recovery and separate Web startup    |
| Smoke adapter, wire budgets, transport          | `pnpm run test:deepseek-offline`  | Real DeepSeek adapter with local SSE, 429 and timeout handling  |
| Benchmark grading, scheduling, integrity        | `pnpm run test:benchmark`         | Correct scoring of success, failure, contamination and timeouts |
| Benchmark adapter and shared wire ledger        | `pnpm run test:benchmark-adapter` | Real-adapter fixture, transport faults and paid CLI rejection   |
| Paired measurement output                       | `pnpm run benchmark:offline`      | Scripted baseline/treatment report and guidance overhead        |

Persistence changes also require restart, corrupt/legacy replay, transitions, idempotency, and relevant admission-race tests. Model-visible changes require canonical Session and actual-request assertions. Scripted fixtures establish wiring and grading; task-effectiveness claims need a separately designed experiment.

## Dependency upgrade policy

`package.json` is the compatibility source of truth: pin all DSH development packages, including their peer-service closure, to one exact release. Limit DSH peer ranges to that baseline's patch release line, explicitly admitting the tested prerelease and excluding the next line. Do not infer compatibility across pre-1.0 releases. Cordis and Schemastery keep their independent ranges; Evolver's own version follows Evolver changes, not the host's release number.

For an upgrade, update all DSH development pins and peer ranges together, run `pnpm install`, and review the lockfile and any exact-version `minimumReleaseAgeExclude` entries; do not disable release-age protection globally. Run `pnpm run check:compatibility` and `pnpm peers check`, the standard gates, and all offline runtime, adapter, benchmark and experience gates (`pnpm run test:experience`) before accepting a new line. The compatibility check is also part of `pnpm test`; integration launchers reject unsupported or mixed host releases before boot. These commands write local dependencies/builds and temporary test evidence, not remote releases, and need no provider credentials. Preserve historical experiment versions and results; a dependency upgrade does not authorize paid reruns.

## Prepare the host

Integration commands build Evolver and use the sibling `../deepseek-harness`. Install that checkout's dependencies and build its public exports and Web assets using its own development instructions. Missing or stale host builds fail; there is no fixture fallback. Resolve DSH/Cordis services consistently through host public exports, without private source imports or mixed published/workspace service versions.

For another host path, build Evolver first and consult `node scripts/runtime-e2e.mjs --help` or `node scripts/benchmark.mjs --help`. Check the live host/product SHAs and dirty state before collecting evidence; a previous run does not validate a different checkout.

## Runtime acceptance contract

The runtime gate boots the shipped Headless profile with real Agents, tools, commands and persisted Sessions, a scripted model adapter, and a harmless probe. It checks failure aggregation; pending/accepted guidance exclusion; human promotion; canonical and request-visible guidance in a fresh Session; exposure-only treatment; rollback; separate-process recovery; privacy sentinels; and disposal. Web coverage is a noninteractive shipped-profile startup smoke, not browser or WebSocket coverage.

Each child uses temporary homes, workspace and state, a scrubbed environment, and disabled production tools, telemetry and retries. Outbound network is blocked and attempts fail assertions. These controls assume trusted plugins; they are not an OS sandbox. The runtime gate limits each child to 20 requests and 60 seconds including teardown. Success requires natural exit after explicit disposal; deadline termination is failure. Temporary files are cleaned after either outcome.

## Evidence and unresolved boundaries

Record the command, environment, exact product/host revisions and dirty state, assertions and safe summary for a new run. Keep raw transient reports outside tracked product documentation. Retain a dated result only when it changes a design decision or is needed to interpret an experiment; do not add passing-test inventories to this guide.

Exposure durability, cross-runtime freshness and provider shutdown constraints live in [architecture](architecture.md). Real-provider authentication and streaming checks use the separately authorized [DeepSeek smoke](deepseek-smoke.md); task-success measurement uses the [paired benchmark](paired-benchmark.md).
