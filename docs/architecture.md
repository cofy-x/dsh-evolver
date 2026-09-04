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
```

The runtime observes the immutable final `tools/result`, ignores successful and agentless calls, and persists neither tool arguments nor returned content. A proposal begins in `evaluating`; deterministic verification moves it to `pending` or `rejected`. Human acceptance moves a verified pending proposal to `accepted`, and promotion is valid only from `accepted`. Repeating the same terminal transition is idempotent.

## Module ownership

| Module        | Responsibility                                                                      |
| :------------ | :---------------------------------------------------------------------------------- |
| `domain.ts`   | Branded identifiers, proposal states, audit vocabulary, service/provider interfaces |
| `config.ts`   | Loader schema and deployment bounds                                                 |
| `proposer.ts` | Deterministic proposal and offline safety-verification providers                    |
| `store.ts`    | Versioned JSONL validation, replay, transition enforcement, atomic commits          |
| `service.ts`  | Input normalization, redaction, provider orchestration, lifecycle admission         |
| `commands.ts` | Human-only `/evolve` query, review, and promotion operations                        |
| `runtime.ts`  | Cordis service, command, DSH event, injection, and teardown wiring                  |

These modules remain one package because the current provider and consumers release together. A provider or consumer becomes a separate package only when it gains an independent lifecycle or distribution need.

## Persistence and recovery

`$DSH_HOME/evolver/audit-v1.jsonl` is the source of truth. Each atomic mutation acquires the DSH file lock, validates and replays the complete stream, appends one or more monotonically sequenced facts in memory, and atomically replaces the file with mode `0600`. The observation, proposal, and verification facts for one collected failure commit together. Corrupt JSON, unknown events, sequence gaps, invalid references, and invalid transitions fail startup instead of returning partial state.

The MVP chooses JSONL because the stream is small, writes are infrequent, and audit readability matters more than indexed queries. SQLite becomes justified only after measured volume or multi-process query requirements exceed whole-log replay.

## Model experience

Before promotion, the plugin adds no model tokens and changes no tool schema. On a later `agent/session-start`, up to the configured number of promoted strategies are combined into one plugin-sourced instruction message and queued with `agent.inject()`. The existing Agent loop commits that message as canonical Session input before it reaches a model request. The injected text is bounded by the maximum strategy count and fixed-size proposal guidance.

## Security invariants

- Tool arguments, result content, complete transcripts, reasoning, and credentials never enter the audit store.
- Evidence is whitespace-normalized, bounded, and redacts common credential, URL, and home-path forms.
- Proposals are text guidance only and cannot execute work.
- The verifier cannot accept or promote; the collector cannot bypass verification; promotion cannot bypass human acceptance.
- Plugin disposal removes event and command registrations, stops mutation admission, and awaits the write queue.
- No network endpoint is contacted by the MVP.

## Deferred adapters

`dsh-as-a-verifier` can later implement the verification provider after a bounded candidate/evidence contract is agreed. `dsh-automation` can schedule analysis or replay Runs without moving its queue, leases, or recovery state into this repository. Skill materialization, Console/Trajectory projections, LLM proposal providers, benchmarks, shared networks, and isolated worktree code evolution remain outside the MVP.
