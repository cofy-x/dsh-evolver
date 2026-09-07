# Paired recovery benchmark

[English](paired-benchmark.md) | [简体中文](paired-benchmark.zh.md) | [Documentation map](README.md)

Status: offline benchmark plus an explicit, pilot-only real DeepSeek adapter mode. The [authorized 2026-09-06 pilot](pilot-result-2026-09-06.md) completed with both arms failing all three task goals within the budget; this is not a positive effectiveness result. The successful [live lifecycle smoke](deepseek-smoke.md) proves different properties and is not reused as effectiveness evidence. Default execution remains credential-free; paid execution is separately authorized.

## Scope and entry points

`pnpm run benchmark:offline` builds Evolver and runs the three pilot task pairs. `pnpm run test:benchmark` builds it and runs explicit scoring/integrity regression scenarios through real shipped Headless processes. `pnpm test` includes the pure task-oracle, partition, scheduling, report, and existing budget tests. Requirements are Node 24, pnpm 11, and the built sibling Harness checkout described in [runtime validation](runtime-validation.md). The CLI reference is `node scripts/benchmark.mjs --help`; an explicit host checkout can be selected with `--harness=PATH`.

The runner writes only to a generated temporary experiment directory. It deletes that directory, including canonical Sessions and Evolver journals, after completion/failure. Child logs are discarded; a safe structured JSON report goes to stdout. In offline modes no real key is inspected or inherited and outbound network is blocked. The only exposed tool mutates a closure-owned simulated record; it has no filesystem, shell, network, or scoring capability. As with the smoke runner, these are test controls over trusted plugins, not an OS security sandbox.

## Responsibilities

- `scripts/benchmark/tasks.mjs`: versioned development/pilot/heldout fixtures, synthetic tool world, independent exact-state oracle, and explicitly white-box offline response scripts.
- `scripts/benchmark/driver.mjs`: one fresh shipped Headless process, public Agent/tool/Session execution, journal preparation, guidance checks, request/tool ceilings, and teardown.
- `scripts/benchmark/report.mjs`: reproducible pair ordering and descriptive paired outcomes/cost deltas; it does not use Evolver's failure-rate verdict.
- `scripts/benchmark.mjs`: process isolation, timeouts, complete run ledger, cross-arm integrity checks, implementation/fixture fingerprints, and cleanup.
- `scripts/runtime-e2e/host.mjs`: public-export resolution and isolated profile entry list shared with the existing smoke runner. No product API or audit protocol was changed.

## Experimental units and treatment

Each task has a baseline and treatment run. Both are actual shipped Headless invocations, with the same tool schema, task prompt, model configuration, task initial state, and budget. A byte-identical accepted proposal journal is copied to each arm's separate DSH home; treatment alone promotes the proposal before the task starts. Each arm has a new canonical Session and process. Both use the same empty workspace path within a pair to avoid putting arm-specific paths into model context; the simulated world itself is new and independent. There is no cross-task Session or evolving promoted-strategy reuse.

The seed comes from a development fixture's deliberately failed tool-world operation submitted to the public Evolver service. The existing deterministic proposer/verifier and public accept/promote operations are used. This is explicitly service-level synthetic training, not model-generated training or a new learning algorithm. Heldout answers and parameters never enter the seed. Task failures can create pending proposals during execution, but the runner never promotes those; promoted guidance is frozen for the run.

The current proposer emits the same generic diagnostic strategy for the shared tool/error code across these families. Consequently the experiment tests generic promoted recovery advice, not task-specific learned knowledge, semantic pattern matching, or autonomous source evolution. The benchmark does not change the proposer to force a gain.

Before the first actual adapter response, the driver checks guidance absence for baseline and presence for treatment. The controller compares hashes of the complete first model-visible request after removing only the Evolver-sourced instruction message; message IDs/source metadata are excluded, but message text, system text, tools, and model are not normalized. Initial task state, seed journal, and guidance hashes must match. Canonical persisted user messages are checked too. Comparison failure invalidates the pair rather than being scored as a strategy loss. Later request histories legitimately diverge with actions, so later whole-request equality is not required.

## Task bank and scoring

The bank contains three development tasks, three separate pilot tasks, and twelve heldout instances (four per family). IDs and parameters are disjoint; prompt/schema/world rules and partitions are versioned. The heldout designation reserves instances from live strategy tuning; fixtures remain inspectable by developers and white-box offline oracle tests. It is not a secrecy or external benchmark claim.

| Family       | Goal                                       | Recoverable failure                 | Independent oracle       |
| :----------- | :----------------------------------------- | :---------------------------------- | :----------------------- |
| Precondition | Store the requested value                  | Stale revision                      | Exact stored value       |
| Format       | Store a value satisfying record validation | Non-uppercase value                 | Exact normalized target  |
| Batch        | Complete the specified queue               | Atomic rejection of oversized batch | Exact completed-item set |

Prompts specify goals, not correct tool-call sequences. Only the offline response generator knows the solution; the task tool's inspect/error responses expose recoverable constraints normally. Invalid batches must not partially mutate state. Assistant text such as “Task complete” has no scoring authority. `goalReached` is the exact-state oracle; `success` additionally requires normal completion within budgets, so an already-correct state followed by runaway calls is visible but not a successful bounded run.

Reports retain both arms of every planned pair. Budget exhaustion and timeouts after verified request admission count as unsuccessful runs; unknown counters after a killed process stay null, not zero. Infrastructure, contamination, missing integrity evidence, changed implementation, and not-started runs remain explicitly invalid/incomplete. They are reported with the planned denominator rather than silently dropped. No automatic replacement run is made. A report with invalid pairs exits nonzero; a valid report with task failures can exit zero because failure is a legitimate measurement outcome.

Primary descriptive output is the paired table: both succeeded, treatment only, baseline only, both failed, plus invalid pairs. The rate delta is treatment minus baseline over valid pairs, alongside planned and valid counts. Per-pair differences include calls, repeated identical invalid calls, requests, input/output units, and elapsed time. Offline units are serialized byte estimates and `usage` is null; they must never be presented as actual model tokens. Latency includes startup/teardown overhead and is not a provider latency measurement. No p-value, statistical-significance claim, or automatic promotion decision is emitted.

## Reproducibility and limits

The seed deterministically orders tasks; arm order alternates baseline-first and treatment-first. Three pairs cannot have perfectly balanced order, and the report preserves the exact execution order. This scheduling seed is not a model sampling seed. Model prompt/tool configuration is identical between arms except guidance; the default scripted behavior is also identical, so zero success-rate delta is expected.

The report includes fixture, plan, implementation, initial-state, seed-journal, and guidance hashes plus product/Harness SHAs and dirty flags. Implementation contents are checked before and after the experiment; mid-run changes invalidate comparisons. Seed journal IDs/timestamps vary between invocations, but each pair receives identical accepted bytes. Re-running a plan therefore does not require equal generated journal hashes across separate experiments.

`BOUNDS` in `report.mjs` defines the offline limits: four model responses and six admitted tool calls per arm, 512 output units per response, 4,096 input units per request, 45 seconds per process, and six minutes overall. The pilot has six runs, hence a maximum of 24 requests, 12,288 reserved output units, and 98,304 input units. `--run-timeout-ms` can only lower the process bound. The parent kills a stuck child, waits for its exit, retains timeout/integrity evidence, and cleans the temporary data. This does not establish cancellation behavior of an external model provider.

## Offline acceptance

The default same-script pilot must produce three both-successful pairs and zero success-rate delta, while showing the extra guidance input overhead. Regression scenarios deliberately manufacture claims without state changes, repeated invalid calls, extra inspection overhead, request-budget exhaustion, infrastructure failure, baseline guidance leakage, and a never-ending response. These scenarios must be recognized correctly; scripted treatment-only wins are scoring tests, not evidence that guidance caused a gain.

## Real adapter pilot contract

After building, `node scripts/benchmark.mjs --adapter=deepseek-fixture` exercises the shipped DeepSeek adapter with local provider SSE, including parallel tool calls. `pnpm run test:benchmark-adapter` checks that path, 429 without retries, hanging transport termination, and paid CLI rejection boundaries. Fixture usage is explicitly synthetic (100 input/10 output per response), never real token evidence. Fault switches are rejected in live mode.

With explicit spending authorization and `DEEPSEEK_API_KEY` already set, run `node scripts/benchmark.mjs --adapter=deepseek-live --allow-paid=yes --model=deepseek-v4-flash`. This uses the same frozen pilot bank, tool schema, task prompt, grader, synthetic accepted seed and guidance, but only real model responses choose runtime actions. Script overrides and heldout execution are forbidden in either DeepSeek mode. Model selection is an explicit CLI value; credentials are environment references, never command arguments. Custom endpoints and other inherited environment configuration are not used. Only the official HTTPS chat-completions destination is admitted, redirects are rejected, thinking is disabled, output is capped at 512 tokens, both adapter retry count and the retry plugin are disabled. No paid retry or replacement arm is automatic.

`transport.mjs` validates and reserves the complete serialized wire request before transport. A single owner-only ledger spans all six sequential child processes; the controller waits for exit before starting another writer. Atomic ledger replacement precedes every request, so failed transports and killed children retain their reservations. This is a sequential test controller, not a general concurrent budget service or crash-resumable experiment. The ceilings are 4 requests/6 tool calls/45 seconds per arm, 24 requests/98,304 conservative input byte units/12,288 reserved output tokens/6 minutes overall. Input reservations are byte-based estimates, not billed token counts. Live `usage` records adapter-reported input including cache tokens and output; missing/invalid usage invalidates the run. `outputUnits` is tokens in transport modes and bytes in scripted mode, so cross-mode cost deltas must not be compared.

First-request equality is checked both on public adapter options and on the actual serialized wire, excluding only the promoted guidance message. Canonical exposure, audit privacy, implementation fingerprints and all planned rows remain checked. Fetch has a maximum 15-second abort deadline and the adapter a 15-second idle timeout; the parent process deadline is the final bound even if teardown/provider code hangs. Process termination does not prove server-side billing cancellation. Reports preserve partial usage where available and experiment-wide reservations even when per-arm counters are unknown. HTTP/provider failures are infrastructure failures, not evidence against the strategy. This experiment neither changes product persistence nor establishes multi-runtime consistency.

After pilot feasibility is established, freeze a separate heldout run plan before viewing outcomes, including repeat count and its new budget. Do not tune guidance on heldout failures and report the retest as the original experiment. Ceiling effects, no gain, or regression are all valid outcomes. Any broader claim about task effectiveness will require more tasks/repetitions and uncertainty analysis beyond this small diagnostic pilot.
