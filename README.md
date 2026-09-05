# DSH Evolver

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

## Architecture

The MVP is one TypeScript function plugin with a complete capability seam: `ctx.evolver` is the service, a deterministic offline provider creates and safety-checks bounded strategy candidates, and DSH event/command adapters are the consumers. It listens to the immutable `tools/result` event, persists metadata-only outcomes while a relevant experiment window is collecting, and atomically records each failed result with its redacted observation and exact failure-pattern occurrence in `$DSH_HOME/evolver/audit-v1.jsonl`.

Equivalent sanitized failures are grouped by a versioned SHA-256 signature over the validated tool name, error code, and canonical summary. Instance-only UUIDs, long hexadecimal values, numeric IDs, URLs, user-home prefixes, credential placeholders, case, and whitespace are normalized. This is intentionally deterministic exact matching, not semantic clustering. The first occurrence reserves generation 1; while a proposal is evaluating, pending, accepted, or promoted, repeats only increment the pattern. After rejection or rollback, the default policy admits the next generation on the fifth new occurrence (generation 2 at occurrence 6). This reduces verifier and future LLM-provider cost while preserving every occurrence as audit evidence.

An observation is the bounded, independently audited fact from one failed call. A pattern is the replayed aggregate over observations with the same exact signature. A proposal is one reviewable strategy generation triggered by an admitted pattern occurrence; it never replaces either evidence layer. Embeddings and LLM classification are intentionally deferred because their nondeterminism, external-data exposure, cost, and threshold tuning would weaken replayability before there is evidence that exact matching is insufficient.

Promotion freezes a bounded historical baseline for the proposal's target tool. Only results from Sessions where that strategy was actually injected count as treatment. The deterministic evaluation reports `insufficient`, `improved`, `neutral`, or `regressed` from configurable sample and failure-rate thresholds. This is an operational heuristic, not a causal or statistical-significance claim, so rollback remains an explicit human action.

Admission uses a durable reservation: occurrence recording and generation ownership are decided under the same cross-process lock, provider work runs outside the lock, and finalization rechecks ownership under lock. Provider failure releases the reservation; a crashed or timed-out owner is reclaimed by the next matching occurrence after the configured expiry. The JSONL audit stream is versioned and replayed at startup. Writes use atomic whole-file replacement with owner-only permissions. The service exposes stable read projections for future Console, Trajectory, verifier, and automation adapters. See [the architecture guide](docs/architecture.md).

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

```sh
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
pnpm pack --dry-run
```

The keyless suite covers signature canonicalization and field boundaries, concurrent admission, generation thresholds, reservation expiry and provider failure, persistence restart and legacy-log replay, corruption rejection, state-transition idempotency, redaction, outcome deduplication, generation-isolated baseline/treatment evaluation, effectiveness verdicts, rollback, Cordis disposal, model-visible promoted-context snapshots, and minimal Loader composition.

With a built sibling Harness checkout, run `pnpm run test:runtime` for the shipped Headless lifecycle and separate Web startup smoke. It uses real Agents, tools, commands, and persisted Sessions with only a scripted model adapter and harmless probe. No credentials or model network are used. See [runtime evidence and prerequisites](docs/runtime-validation.md) and [the opt-in DeepSeek plan](docs/validation-plan.md).

## Prior Art and Acknowledgements

`dsh-evolver` is an independent, DSH-native implementation of auditable agent self-evolution. Its design is inspired in part by [EvoMap/evolver](https://github.com/EvoMap/evolver) and broader experience-driven agent-evolution research. It is not affiliated with or endorsed by EvoMap. No EvoMap source code, prompts, private formats, or protocol compatibility claims are used by this implementation.

## Known Limitations and Deferred Work

The MVP proposes only from failed top-level or nested DSH tool results associated with an Agent. Its effectiveness comparison is a bounded before/after heuristic: it does not randomize assignment, control for workload changes, claim statistical significance, or inspect semantic task success. Pattern matching is versioned and exact after canonicalization; it does not perform semantic similarity, and pre-upgrade proposals remain valid but are not retroactively attached to new patterns. It uses one deterministic proposal template and an offline structural safety verifier; it does not yet call `dsh-as-a-verifier`, replay Sessions, compare snapshots, materialize skills, schedule `dsh-automation` Runs, expose a dedicated UI projection, compact long audit streams, share assets, or evolve source code. Promoted guidance is applied at Session start, so promotion does not retroactively change an already-started Agent.

## License

[MIT](LICENSE).
