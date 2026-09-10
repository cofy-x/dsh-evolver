# Architecture and direction

[English](architecture.md) | [简体中文](architecture.zh.md) | [Documentation map](README.md)

Evolver owns proposal lifecycle and bounded diagnostic evidence. DSH owns Agents, canonical Sessions, model execution, tools, commands, credentials and permissions. Integrations use public services and events; private Harness imports and unlogged request mutation are forbidden.

## Lifecycle

```text
tool failure → redacted observation → exact pattern → reserved generation
→ proposal → verification → human acceptance → promotion
→ logged guidance in a later Session → bounded evaluation → human keep/rollback
```

The collector observes final Agent-associated `tools/result` events. A proposal starts `evaluating`; verification produces `pending` or `rejected`. Only a verified pending proposal may be accepted, only an accepted proposal may be promoted, and rollback supersedes promoted guidance. Repeated identical transitions are idempotent. Verification never supplies human approval. The current proposer and structural verifier are deterministic and offline.

A pattern is an exact, versioned signature over tool name, error code and canonicalized redacted summary, not semantic matching. Observations retain their provenance; each proposal generation links to its admitting occurrence. An active generation blocks another for that pattern. Rejected or superseded generations require the configured number of additional occurrences before readmission; generations never share evaluation cohorts.

Admission reserves ownership in one locked transaction, runs providers outside the lock, then commits only if the same reservation is live. Failure abandons ownership without losing the occurrence. A later occurrence can reclaim an expired lease; stale completions fail closed. Expiry does not cancel a provider.

## Persistence and privacy

`$DSH_HOME/evolver/audit-v1.jsonl` is authoritative unless `dataDir` overrides its directory. Mutations acquire the DSH file lock, replay and validate the complete stream, append monotonically sequenced facts, then atomically replace the owner-only file. New writes and restart replay use the same codec and lifecycle invariants. Corrupt streams, invalid references or transitions fail closed; supported legacy events remain readable without rewriting history.

The audit retains bounded redacted failure summaries, identifiers, proposal/verification facts, outcome metadata and exposure records. It excludes complete Session events, reasoning, tool arguments, credentials, successful values and complete output. Successes outside a collecting evaluation window are discarded. Redaction covers common credential, URL and home-path forms but is not a general sensitive-data classifier.

All Cordis registrations are effect-owned. Disposal removes contributions, stops new mutation admission and waits for admitted provider/persistence work. No observation, proposal or shared text may execute commands, edit source or modify evaluator, verifier, approval or safety policy.

## Guidance and evaluation

Before promotion there are no added model tokens or tool-schema changes. A later `agent/session-start` combines a bounded number of promoted strategies into one plugin-sourced instruction through `agent.inject()`. DSH commits that input to canonical Session history before model use. Rollback stops future injection; existing Sessions are not rewritten.

Promotion freezes a bounded baseline at the triggering observation's audit boundary. Treatment contains matching tool outcomes only from Sessions with recorded exposure. Outcome identity is `(sessionId, callId)`; generations are separated by audit sequence, not timestamp coincidence. Legacy unassociated proposals retain their original baseline semantics.

Once both cohorts have enough samples, failure-rate deltas produce `improved`, `regressed` or `neutral`; otherwise the verdict is `insufficient`. Windows stop when full. This is a descriptive operational signal, not causal or statistically significant task-effectiveness evidence, and never changes lifecycle state automatically. Use the independent [paired benchmark](paired-benchmark.md) for task-level comparisons.

## Future priorities and extension gates

First establish strategy value: the fixed diagnostic template has no demonstrated task-success gain. Future experiments need informative tasks, frozen candidates, independent grading and preserved failures; adding an LLM proposer alone does not solve this evidence gap.

External proposal or verification providers require bounded candidate/evidence contracts, deadlines, cooperative cancellation, stale-result fencing and a disposal budget. A provider that never settles currently delays disposal indefinitely. Automation and UI may consume public lifecycle operations, but must not bypass human review or take ownership of DSH services. Code evolution and network sharing are not implemented.

Use one active runtime per data directory. File locks serialize writes, but synchronous reads are process-local snapshots refreshed by the next transaction. Multiple runtimes require explicit freshness at query and injection boundaries. Exposure persistence follows synchronous injection asynchronously; the stores do not share an atomic transaction. Crash-consistent measurement needs a coordinated awaitable boundary before it can be claimed.

Whole-log replay/replacement and unbounded failure history suit experimental volume only. Measure log growth, mutation latency and query needs before choosing compaction or SQLite. Keep one package while providers and consumers release together; split only for an independent lifecycle or distribution need.
