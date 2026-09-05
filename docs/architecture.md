# DSH Evolver architecture

DSH Evolver is a proposal lifecycle plugin, not an Agent implementation or autonomous code editor. DSH remains authoritative for Agents, model requests, tools, commands, canonical Session history, permissions, and credentials.

## Vertical MVP

```text
failed tools/result
  -> bounded redacted observation
  -> versioned exact failure pattern
  -> durable generation reservation
  -> deterministic strategy proposal
  -> deterministic safety verification
  -> human accept or reject
  -> explicit promotion
  -> logged agent.inject() context on a later Session start
  -> exposure-scoped outcome window
  -> deterministic effectiveness verdict
  -> human keep or rollback
```

The runtime observes the immutable final `tools/result`, ignores agentless calls, and persists only outcome metadata plus bounded evidence for failures—never tool arguments, successful values, or returned content. Each failure increments one exact pattern before proposal admission is considered. A proposal begins in `evaluating`; deterministic verification moves it to `pending` or `rejected`. Human acceptance moves a verified pending proposal to `accepted`, and promotion is valid only from `accepted`. Promotion starts a bounded evaluation; human rollback moves a promoted proposal to `superseded`. Repeating the same transition is idempotent.

## Module ownership

| Module          | Responsibility                                                                      |
| :-------------- | :---------------------------------------------------------------------------------- |
| `domain.ts`     | Branded identifiers, proposal states, audit vocabulary, service/provider interfaces |
| `config.ts`     | Loader schema and deployment bounds                                                 |
| `evaluation.ts` | Pure baseline/treatment verdict calculation                                         |
| `pattern.ts`    | Pure summary canonicalization and versioned deterministic pattern signatures        |
| `proposer.ts`   | Deterministic proposal and offline safety-verification providers                    |
| `store.ts`      | Versioned JSONL validation, replay, transition enforcement, atomic commits          |
| `service.ts`    | Input normalization, redaction, provider orchestration, lifecycle admission         |
| `commands.ts`   | Human-only `/evolve` query, review, and promotion operations                        |
| `runtime.ts`    | Cordis service, command, DSH event, injection, and teardown wiring                  |

These modules remain one package because the current provider and consumers release together. A provider or consumer becomes a separate package only when it gains an independent lifecycle or distribution need.

## Persistence and recovery

`$DSH_HOME/evolver/audit-v1.jsonl` is the source of truth. Each atomic mutation acquires the DSH file lock, validates and replays the complete stream, appends one or more monotonically sequenced facts in memory, and atomically replaces the file with mode `0600`. For a failure, the outcome, observation, pattern creation or increment, and any admission reservation commit together. Corrupt JSON, unknown events, sequence gaps, duplicate outcome keys or occurrence links, invalid references, inconsistent generations or evaluation projections, and invalid transitions fail startup instead of returning partial state. Audit streams produced by the initial MVP and evaluation phase remain replayable without rewriting; their proposals are treated as legacy unassociated proposals.

## Failure patterns and proposal admission

`failure-pattern-v1` hashes the JSON tuple `(version, toolName, errorCode, canonicalSummary)` with Node's SHA-256 implementation. Tool name and error code are validated bounded tokens. The already-redacted summary is lowercased and whitespace-normalized, then UUIDs, long hexadecimal identifiers, standalone numeric IDs, URLs, user-home prefixes, and redacted credential placeholders are replaced with stable markers. Field boundaries remain explicit, so the same summary from different tools or error codes cannot merge. This deliberately offers reproducible exact matching only; semantic similarity and cross-version migration are out of scope.

The three evidence layers have different ownership. An observation is one independently persisted bounded failure fact. A pattern is a deterministic replay projection over observations sharing a signature; it does not replace or rewrite them. A proposal is one verifier-gated strategy generation linked to the exact observation and occurrence that admitted it. Embeddings and LLM classification are deferred because they introduce nondeterministic replay, extra sensitive-data transfer, provider cost, and similarity-threshold policy before operational evidence shows exact matching is inadequate.

Patterns retain occurrence count, first and last timestamps, proposal generation linkage, and at most eight recent representative observation IDs. The first occurrence is immediately eligible for generation 1. An evaluating, pending, accepted, or promoted proposal blocks another generation for its pattern. A rejected or superseded proposal becomes eligible only after exactly `reproposalAfterOccurrences` additional matching failures; with the default five, generation 2 is created at occurrence 6. Evaluation cohorts remain attached to proposal IDs, so generations never share baseline or treatment evidence. Store transition checks also prevent two generations of one pattern from being promoted simultaneously.

Admission is a two-lock protocol around potentially expensive provider work. The first locked transaction records the occurrence and reserves a unique proposal ID and generation. The owner invokes the proposer and verifier outside the lock. A second locked transaction creates the proposal and verification facts only if that exact reservation is still live. Provider failure records abandonment without losing the occurrence. Process crashes can leave a reservation, so it has a bounded lease; after expiry, the next matching occurrence atomically abandons it and reserves the generation again. A stale provider completion then fails closed. Disposal stops new admission and waits for admitted provider and persistence operations to settle.

The MVP chooses JSONL because the stream is small, writes are infrequent, and audit readability matters more than indexed queries. SQLite becomes justified only after measured volume or multi-process query requirements exceed whole-log replay.

## Evaluation loop

An Agent-associated final tool result contributes metadata consisting of a generated outcome ID, Session ID, call ID, tool name, success/failure bit, and timestamp whenever it fails or a relevant baseline/treatment window is still collecting. Successful results outside those windows are discarded, and `(sessionId, callId)` is an idempotency key. For pattern-linked proposals, promotion freezes the first configured number of outcomes starting at the triggering observation's audit boundary, including the immediately preceding triggering failure outcome when present. Audit sequence, rather than millisecond timestamps, separates generations. Once that baseline fills, later failure-only audit facts cannot evict its sampled successes. Legacy unassociated proposals retain their original timestamp-based baseline semantics; already-persisted promotion evaluations remain unchanged. `agent/session-start` records which promoted strategies were injected, and only matching tool results from those exposed Sessions enter each treatment window.

Observation timestamps describe event time, not transaction order. Patterns project the minimum and maximum observed timestamps while occurrence numbers follow audit commit order. Reservation leases use the lock holder's current time so queueing delay does not consume the lease before admission. Every newly written event passes the same parser used by restart replay before the atomic file replacement.

After both cohorts reach `minimumEvaluationSamples`, the evaluator compares failure rates. A delta at or below the negative threshold is `improved`, a delta at or above the positive threshold is `regressed`, and smaller changes are `neutral`; smaller cohorts are `insufficient`. The fixed-size treatment window stops accumulating when full. This transparent heuristic detects obvious operational regressions but does not establish causality or statistical significance. It informs human review and never triggers automatic rollback.

## Model experience

Before promotion, the plugin adds no model tokens and changes no tool schema. On a later `agent/session-start`, up to the configured number of promoted strategies are combined into one plugin-sourced instruction message and queued with `agent.inject()`. The existing Agent loop commits that message as canonical Session input before it reaches a model request. The injected text is bounded by the maximum strategy count and fixed-size proposal guidance.

## Security invariants

- Tool arguments, successful values, result content, complete transcripts, reasoning, and credentials never enter the audit store.
- Evidence is whitespace-normalized, bounded, and redacts common credential, URL, and home-path forms.
- Proposals are text guidance only and cannot execute work.
- The verifier cannot accept or promote; the collector cannot bypass verification; promotion cannot bypass human acceptance.
- Evaluation cannot promote, reject, or rollback; only an explicit human rollback supersedes active guidance.
- Plugin disposal removes event and command registrations, stops mutation admission, and awaits the write queue.
- No network endpoint is contacted by the MVP.

## Deferred adapters

`dsh-as-a-verifier` can later implement the verification provider after a bounded candidate/evidence contract is agreed. `dsh-automation` can schedule analysis or replay Runs without moving its queue, leases, or recovery state into this repository. Skill materialization, Console/Trajectory projections, LLM proposal providers, benchmarks, shared networks, and isolated worktree code evolution remain outside the MVP.

## Operational limits and next validation

Use one active runtime per data directory for now. Write admission is cross-process serialized, but synchronous reads are process-local snapshots refreshed by that store's next transaction; a second runtime can retain a stale promoted projection after another process rolls it back. A future multi-runtime adapter needs an explicit freshness contract at query and injection boundaries. Exposure persistence is asynchronous after the synchronous Session-start notification, so a storage failure can leave injected context without a durable measurement exposure. This needs a coordinated, awaitable integration boundary before claiming crash-consistent exposure accounting.

Reservation expiry allows another occurrence to reclaim ownership; it does not cancel the original provider call. A provider that never settles can still delay disposal indefinitely. External providers therefore require deadlines, cooperative cancellation, stale-result fencing, and a documented disposal budget before being enabled. The current deterministic provider performs no external work.

Whole-log replay and replacement, unbounded failure history, and repeated evaluation scans are appropriate only for the experimental data volume. Measure latency and log size under representative load before choosing SQLite or snapshot/compaction work. Neither backend choice improves proposal quality: the current fixed diagnostic template and structural verifier do not establish that a strategy improves task success. See [the local validation plan](validation-plan.md) for the next bounded experiment.
