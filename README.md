# DSH Evolver

[English](README.md) | [简体中文](README.zh.md)

Auditable, verifier-gated strategy evolution for DeepSeek Harness.

DSH Evolver turns bounded execution failures into reviewable strategy proposals. Verification, human acceptance and explicit promotion must all happen before guidance reaches a later Session. It does not autonomously edit DSH, plugins or user code. The product is experimental: its fixed diagnostic template and structural verifier do not establish improved task success.

## Use

Install the published alpha into a DSH profile, then restart that profile:

```sh
dsh plugin --profile web add dsh-evolver@alpha
dsh --profile web --dump-config
```

The archive includes built JavaScript and declarations. Replace `alpha` with a published version for an exact candidate. [package.json](package.json) declares the development baseline and host compatibility; the registry channel may still point to an earlier release. Git installation remains available as `dsh plugin --profile web add github:cofy-x/dsh-evolver` and requires the development toolchain.

After a model-requested tool fails, use a command-capable DSH client:

```text
/evolve list
/evolve patterns
/evolve pattern <pattern-id>
/evolve show <proposal-id>
/evolve accept <proposal-id>
/evolve promote <proposal-id>
/evolve evaluate <proposal-id>
```

Acceptance and promotion are separate human decisions. Reject with `/evolve reject <proposal-id> <reason>`; withdraw active guidance with `/evolve rollback <proposal-id> <reason>`. Promotion and rollback affect later Sessions without erasing history.

## Contract

The offline plugin exposes `ctx.evolver`, groups redacted failures into exact-signature patterns and manages proposal generations. Only promoted text enters model context through the public, logged `agent.inject()` channel. Evaluation is an exposure-scoped failure-rate comparison that informs human decisions, not automatic rollback or proof of causality.

The audit stores bounded diagnostic facts and canonical Session references, never complete transcripts, reasoning, tool arguments, credentials or complete tool output. Redaction is defensive, not a guarantee that arbitrary text is nonsensitive; protect the owner-only audit file. Use one active runtime per data directory.

Configuration is defined by [the loader schema](src/config.ts). The [profile patch](cordis.patch.yml) adds an optional plugin row to Web or Headless profiles. Evolver owns neither model credentials nor tool permissions and cannot execute proposal text or rewrite verifier, evaluator, approval or safety policy.

## Develop and extend

Use Node.js 24 or newer and pnpm 11:

```sh
git clone https://github.com/cofy-x/dsh-evolver.git
cd dsh-evolver
pnpm install --frozen-lockfile
pnpm run build
```

Use `pnpm run prepare:harness` to build the pinned released Harness source for integration tests. Follow [AGENTS.md](AGENTS.md) and the [verification guide](docs/runtime-validation.md). The [documentation map](docs/README.md) routes architecture, release and experiment work. [Architecture](docs/architecture.md) defines future priorities and extension prerequisites: establish useful strategy evidence before adding providers, automation or storage complexity.

## Prior art and license

This independent, MIT-licensed DSH-native implementation is inspired in part by [EvoMap/evolver](https://github.com/EvoMap/evolver) and experience-driven agent-evolution research. It is not affiliated with or endorsed by EvoMap; no EvoMap source code, prompts or private formats are implementation inputs, and no protocol compatibility is claimed. See [LICENSE](LICENSE).
