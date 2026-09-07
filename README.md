# DSH Evolver

[English](README.md) | [简体中文](README.zh.md)

**Auditable, verifier-gated self-evolution for DeepSeek Harness.**

> [!WARNING]
>
> Status: early development and experimental. DSH Evolver creates reviewable strategy proposals; it does not autonomously modify DSH, plugins, or user source code.

DSH Evolver turns bounded facts from agent execution into reusable strategy guidance with explicit verification, human review, and promotion. Unlike ordinary memory, collected failures do not immediately influence future requests. Unlike a skill library, a candidate is tied to provenance and an auditable lifecycle before it can become active.

```text
DSH events
  -> observations
  -> exact failure patterns
  -> proposal admission
  -> proposal
  -> verification
  -> human review
  -> promotion or rejection
  -> baseline/treatment evaluation
  -> keep or human rollback
```

## Minimal example

Install the Git repository into a DSH profile and restart that profile:

```sh
dsh plugin --profile web add github:cofy-x/dsh-evolver
dsh --profile web --dump-config
```

After a model-requested tool fails, inspect and review the generated proposal through a command-capable DSH client:

```text
/evolve list
/evolve patterns
/evolve pattern <pattern-id>
/evolve show <proposal-id>
/evolve accept <proposal-id>
/evolve promote <proposal-id>
/evolve evaluate <proposal-id>
```

A rejected candidate uses `/evolve reject <proposal-id> <reason>`. Promotion is deliberately separate from acceptance. A promoted strategy is injected only when a later Agent Session starts, through DSH's existing logged `agent.inject()` path. If measured results regress or an operator otherwise withdraws the strategy, `/evolve rollback <proposal-id> <reason>` records the decision and stops future injection without erasing history.

## How it works

The plugin exposes `ctx.evolver`, records tool failures as redacted observations, groups them into exact-signature patterns, and generates strategy proposals checked by an offline structural safety verifier. After human acceptance and promotion, guidance enters later Sessions through logged `agent.inject()`.

Baseline/treatment tool failure rates inform human rollback decisions. The current proposer uses a fixed diagnostic template; improved task success has not been established. See [architecture](docs/architecture.md) for state transitions, persistence, and consistency limits.

## Safety model

- Default output is a proposal, never a source edit or command execution.
- Only bounded strategy guidance is implemented; evaluator, verifier, approval, and safety policy self-modification are forbidden.
- Deterministic verification must pass before human acceptance, and explicit acceptance must precede promotion.
- The model receives only promoted strategies, through a canonical logged DSH message.
- The collector stores no complete transcript, reasoning, tool arguments, credentials, or complete tool output.
- The MVP is offline and contacts no external network.
- Effectiveness facts are metadata-only, bounded by fixed experiment windows, and cannot automatically mutate lifecycle state.
- Cordis owns every registration, and disposal removes contributions and drains admitted writes.

## Installation

Development and Git installation require Node.js 24 or newer and pnpm 11. DSH Evolver is not published to npm.

```sh
git clone https://github.com/cofy-x/dsh-evolver.git
cd dsh-evolver
pnpm install --frozen-lockfile
pnpm run build
```

The included `cordis.patch.yml` inserts one optional `dsh-evolver` row into a selected Web or Headless profile. Configuration supports `dataDir`, `maxEvidenceChars`, `maxPromotedStrategies`, `evaluationWindowSize` (default 20), `minimumEvaluationSamples` (default 5), `regressionThreshold` (default 0.15), `reproposalAfterOccurrences` (default 5, maximum 1000), and `generationReservationTimeoutMs` (default 300000, maximum 86400000); invalid or unsafe bounds fail plugin loading.

## Data and privacy

The store contains Session and call identifiers, tool names, sampled success/failure outcomes, error codes, bounded redacted summaries, proposal text, verification evidence, exposure records, aggregate evaluation projections, and lifecycle facts. Successful outcomes with no collecting baseline or treatment window are discarded. The store does not retain tool arguments, successful values, returned content, or duplicate canonical DSH Session events. Common credential forms, URLs, and user home prefixes are redacted before persistence, but operators should still treat the owner-only audit file as potentially sensitive diagnostic data.

## Development

[Package scripts](package.json) define development commands. Select [verification gates](docs/runtime-validation.md) for the changed boundary and follow [AGENTS.md](AGENTS.md). The [documentation map](docs/README.md) routes architecture, paid smoke, and paired experiment work.

## Prior Art and Acknowledgements

`dsh-evolver` is an independent, DSH-native implementation of auditable agent self-evolution. Its design is inspired in part by [EvoMap/evolver](https://github.com/EvoMap/evolver) and broader experience-driven agent-evolution research. It is not affiliated with or endorsed by EvoMap. No EvoMap source code, prompts, private formats, or protocol compatibility claims are used by this implementation.

## Operational limits

Use one active runtime per data directory. Promotion and rollback affect later Sessions; exposure persistence and Session writes are not atomic across stores. The product remains offline; external verifiers, LLM proposal generation, and code evolution are not implemented. See [architecture](docs/architecture.md) for extension prerequisites.

## License

[MIT](LICENSE).
