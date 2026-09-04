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
```

A rejected candidate uses `/evolve reject <proposal-id> <reason>`. Promotion is deliberately separate from acceptance. A promoted strategy is injected only when a later Agent Session starts, through DSH's existing logged `agent.inject()` path.

## Architecture

The MVP is one TypeScript function plugin with a complete capability seam: `ctx.evolver` is the service, a deterministic offline provider creates and safety-checks bounded strategy candidates, and DSH event/command adapters are the consumers. It listens to the immutable `tools/result` event, persists a redacted observation, and atomically records proposal and verification facts in `$DSH_HOME/evolver/audit-v1.jsonl`.

The JSONL audit stream is versioned and replayed at startup. Writes use a cross-process lock and atomic whole-file replacement with owner-only permissions. The service exposes stable read projections for future Console, Trajectory, verifier, and automation adapters. See [the architecture guide](docs/architecture.md).

## Safety model

- Default output is a proposal, never a source edit or command execution.
- Only bounded strategy guidance is implemented; evaluator, verifier, approval, and safety policy self-modification are forbidden.
- Deterministic verification must pass before human acceptance, and explicit acceptance must precede promotion.
- The model receives only promoted strategies, through a canonical logged DSH message.
- The collector stores no complete transcript, reasoning, tool arguments, credentials, or complete tool output.
- The MVP is offline and contacts no external network.
- Cordis owns every registration, and disposal removes contributions and drains admitted writes.

## Installation

Development and Git installation require Node.js 24 or newer and pnpm 11. DSH Evolver is not published to npm.

```sh
git clone https://github.com/cofy-x/dsh-evolver.git
cd dsh-evolver
pnpm install --frozen-lockfile
pnpm run build
```

The included `cordis.patch.yml` inserts one optional `dsh-evolver` row into a selected Web or Headless profile. Configuration supports `dataDir`, `maxEvidenceChars`, and `maxPromotedStrategies`; invalid or unsafe bounds fail plugin loading.

## Data and privacy

The store contains Session identifiers, tool names, error codes, bounded redacted summaries, proposal text, verification evidence, and lifecycle facts. It does not duplicate canonical DSH Session events. Common credential forms, URLs, and user home prefixes are redacted before persistence, but operators should still treat the owner-only audit file as potentially sensitive diagnostic data.

## Development

```sh
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
pnpm pack --dry-run
```

The keyless suite covers persistence restart, corruption rejection, state-transition idempotency, redaction, Cordis disposal, model-visible promoted-context snapshots, and Web/Headless composition through the real Cordis Loader.

## Prior Art and Acknowledgements

`dsh-evolver` is an independent, DSH-native implementation of auditable agent self-evolution. Its design is inspired in part by [EvoMap/evolver](https://github.com/EvoMap/evolver) and broader experience-driven agent-evolution research. It is not affiliated with or endorsed by EvoMap. No EvoMap source code, prompts, private formats, or protocol compatibility claims are used by this implementation.

## Known Limitations and Deferred Work

The MVP observes only failed top-level or nested DSH tool results associated with an Agent. It uses one deterministic proposal template and an offline structural safety verifier; it does not yet call `dsh-as-a-verifier`, replay Sessions, compare snapshots, materialize skills, schedule `dsh-automation` Runs, expose a dedicated UI projection, deduplicate equivalent failures, compact long audit streams, share assets, or evolve source code. Promoted guidance is applied at Session start, so promotion does not retroactively change an already-started Agent.

## License

[MIT](LICENSE).
