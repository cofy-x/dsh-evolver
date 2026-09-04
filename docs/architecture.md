# DSH Evolver architecture

DSH Evolver is a proposal lifecycle plugin, not an Agent implementation or autonomous code editor. DSH remains authoritative for Agents, model requests, tools, commands, canonical Session history, permissions, and credentials.

## Vertical MVP

```text
failed tools/result
  -> bounded redacted observation
  -> deterministic strategy proposal
  -> deterministic safety verification
  -> human accept or reject
  -> explicit promotion
  -> logged agent.inject() context on a later Session start
  -> exposure-scoped outcome window
  -> deterministic effectiveness verdict
  -> human keep or rollback
```

The runtime observes the immutable final `tools/result`, ignores agentless calls, and persists only outcome metadata plus bounded evidence for failures—never tool arguments, successful values, or returned content. A proposal begins in `evaluating`; deterministic verification moves it to `pending` or `rejected`. Human acceptance moves a verified pending proposal to `accepted`, and promotion is valid only from `accepted`. Promotion starts a bounded evaluation; human rollback moves a promoted proposal to `superseded`. Repeating the same transition is idempotent.

## Module ownership

| Module          | Responsibility                                                                      |
| :-------------- | :---------------------------------------------------------------------------------- |
| `domain.ts`     | Branded identifiers, proposal states, audit vocabulary, service/provider interfaces |
| `config.ts`     | Loader schema and deployment bounds                                                 |
| `evaluation.ts` | Pure baseline/treatment verdict calculation                                         |
| `proposer.ts`   | Deterministic proposal and offline safety-verification providers                    |
| `store.ts`      | Versioned JSONL validation, replay, transition enforcement, atomic commits          |
| `service.ts`    | Input normalization, redaction, provider orchestration, lifecycle admission         |
| `commands.ts`   | Human-only `/evolve` query, review, and promotion operations                        |
| `runtime.ts`    | Cordis service, command, DSH event, injection, and teardown wiring                  |

These modules remain one package because the current provider and consumers release together. A provider or consumer becomes a separate package only when it gains an independent lifecycle or distribution need.

## Persistence and recovery

`$DSH_HOME/evolver/audit-v1.jsonl` is the source of truth. Each atomic mutation acquires the DSH file lock, validates and replays the complete stream, appends one or more monotonically sequenced facts in memory, and atomically replaces the file with mode `0600`. The outcome, observation, proposal, and verification facts for one collected failure commit together. Corrupt JSON, unknown events, sequence gaps, duplicate outcome keys, invalid references, inconsistent evaluation projections, and invalid transitions fail startup instead of returning partial state. Audit streams produced by the initial MVP before promotion evaluations existed remain replayable with the documented default policy.

The MVP chooses JSONL because the stream is small, writes are infrequent, and audit readability matters more than indexed queries. SQLite becomes justified only after measured volume or multi-process query requirements exceed whole-log replay.

## Evaluation loop

An Agent-associated final tool result contributes metadata consisting of a generated outcome ID, Session ID, call ID, tool name, success/failure bit, and timestamp only when it creates a failure proposal or a relevant baseline/treatment window is still collecting. Successful results outside those windows are discarded, and `(sessionId, callId)` is an idempotency key. Promotion freezes the configured outcome window collected since that proposal was created as its baseline. `agent/session-start` records which promoted strategies were injected, and only matching tool results from those exposed Sessions enter each treatment window.

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
