# DSH Evolver

**Auditable, verifier-gated self-evolution for DeepSeek Harness.**

> [!WARNING]
>
> Status: early development and experimental. DSH Evolver creates reviewable strategy proposals; it does not autonomously modify DSH, plugins, or user source code.

DSH Evolver turns bounded facts from agent execution into reusable strategy guidance with explicit verification, human review, and promotion. Unlike ordinary memory, collected failures do not immediately influence future requests. Unlike a skill library, a candidate is tied to provenance and an auditable lifecycle before it can become active.

```text
DSH events
  -> observations
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
/evolve show <proposal-id>
/evolve accept <proposal-id>
/evolve promote <proposal-id>
/evolve evaluate <proposal-id>
```

A rejected candidate uses `/evolve reject <proposal-id> <reason>`. Promotion is deliberately separate from acceptance. A promoted strategy is injected only when a later Agent Session starts, through DSH's existing logged `agent.inject()` path. If measured results regress or an operator otherwise withdraws the strategy, `/evolve rollback <proposal-id> <reason>` records the decision and stops future injection without erasing history.

## Architecture

The MVP is one TypeScript function plugin with a complete capability seam: `ctx.evolver` is the service, a deterministic offline provider creates and safety-checks bounded strategy candidates, and DSH event/command adapters are the consumers. It listens to the immutable `tools/result` event, persists metadata-only outcomes while a relevant experiment window is collecting, and atomically records each failed result with its redacted observation, proposal, and verification facts in `$DSH_HOME/evolver/audit-v1.jsonl`.

Promotion freezes a bounded historical baseline for the proposal's target tool. Only results from Sessions where that strategy was actually injected count as treatment. The deterministic evaluation reports `insufficient`, `improved`, `neutral`, or `regressed` from configurable sample and failure-rate thresholds. This is an operational heuristic, not a causal or statistical-significance claim, so rollback remains an explicit human action.

The JSONL audit stream is versioned and replayed at startup. Writes use a cross-process lock and atomic whole-file replacement with owner-only permissions. The service exposes stable read projections for future Console, Trajectory, verifier, and automation adapters. See [the architecture guide](docs/architecture.md).

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

The included `cordis.patch.yml` inserts one optional `dsh-evolver` row into a selected Web or Headless profile. Configuration supports `dataDir`, `maxEvidenceChars`, `maxPromotedStrategies`, `evaluationWindowSize` (default 20), `minimumEvaluationSamples` (default 5), and `regressionThreshold` (default 0.15); invalid or unsafe bounds fail plugin loading.

## Data and privacy

The store contains Session and call identifiers, tool names, sampled success/failure outcomes, error codes, bounded redacted summaries, proposal text, verification evidence, exposure records, aggregate evaluation projections, and lifecycle facts. Successful outcomes with no collecting baseline or treatment window are discarded. The store does not retain tool arguments, successful values, returned content, or duplicate canonical DSH Session events. Common credential forms, URLs, and user home prefixes are redacted before persistence, but operators should still treat the owner-only audit file as potentially sensitive diagnostic data.

## Development

```sh
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
pnpm pack --dry-run
```

The keyless suite covers persistence restart and legacy-log replay, corruption rejection, state-transition idempotency, redaction, outcome deduplication, baseline/treatment isolation, effectiveness verdicts, rollback, Cordis disposal, model-visible promoted-context snapshots, and Web/Headless composition through the real Cordis Loader.

## Prior Art and Acknowledgements

`dsh-evolver` is an independent, DSH-native implementation of auditable agent self-evolution. Its design is inspired in part by [EvoMap/evolver](https://github.com/EvoMap/evolver) and broader experience-driven agent-evolution research. It is not affiliated with or endorsed by EvoMap. No EvoMap source code, prompts, private formats, or protocol compatibility claims are used by this implementation.

## Known Limitations and Deferred Work

The MVP proposes only from failed top-level or nested DSH tool results associated with an Agent. Its effectiveness comparison is a bounded before/after heuristic: it does not randomize assignment, control for workload changes, claim statistical significance, or inspect semantic task success. It uses one deterministic proposal template and an offline structural safety verifier; it does not yet call `dsh-as-a-verifier`, replay Sessions, compare snapshots, materialize skills, schedule `dsh-automation` Runs, expose a dedicated UI projection, deduplicate equivalent failures, compact long audit streams, share assets, or evolve source code. Promoted guidance is applied at Session start, so promotion does not retroactively change an already-started Agent.

## License

[MIT](LICENSE).
