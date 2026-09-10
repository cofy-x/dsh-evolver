# Paired task-effectiveness experiments

[English](paired-benchmark.md) | [简体中文](paired-benchmark.zh.md) | [Documentation map](README.md)

The benchmark measures exact-state task completion independently of Evolver's failure-rate heuristic. Offline fixtures validate wiring and grading, not strategy effectiveness. Real-provider execution always needs separate model and aggregate-budget authorization.

## Offline gates

Prepare a compatible host using [verification](runtime-validation.md), then run the relevant [package scripts](../package.json):

```sh
pnpm run test:benchmark
pnpm run test:benchmark-adapter
pnpm run benchmark:offline
pnpm run test:experience
node scripts/benchmark/diagnostics-check.mjs
```

The experience gate covers development → training → lifecycle → separate-process recovery → freeze → heldout evaluation with the actual DeepSeek adapter over local SSE. Fault checks include missing result delivery, 429 without retries, deadline enforcement, contamination and invalid scoring. No real key is read and outbound network is blocked. Temporary homes, Sessions and journals are cleaned; only safe reports survive. These are controls over trusted plugins, not an OS sandbox.

## Experimental contract

Each pair uses fresh processes and Sessions, identical accepted seed bytes, initial state, prompt, schema, model and budget. Treatment alone promotes guidance. Both the canonical history and first serialized request must prove the intended guidance difference; removing only that guidance must leave equal model-visible requests. Contamination, changed implementation or missing integrity evidence invalidates the pair, rather than counting as a strategy loss.

The versioned [task bank](../scripts/benchmark/tasks.mjs) separates development, pilot and heldout instances for precondition, format and atomic-batch recovery. Heldout means reserved from live tuning, not secret from developers. The independent exact-state oracle ignores assistant claims. `success` additionally requires normal completion within bounds: reaching the goal and then exhausting a budget is unsuccessful.

Retain every planned arm, including task failures, invalid infrastructure results and not-started runs. Unknown counters stay null. Never replace failures automatically or drop them from the planned denominator. Report both-successful, treatment-only, baseline-only, both-failed and invalid pairs, with valid/planned counts and overhead deltas. Serialized byte estimates and fixture usage are not billed model tokens; elapsed time includes process overhead. Descriptive deltas do not establish causality or statistical significance.

The current deterministic proposer emits generic tool/error recovery advice. The legacy pilot uses service-level synthetic training; the experience controller induces explicit development failures through real model/tool execution. Neither is naturally sampled production learning or task-specific learned knowledge.

<a id="real-experience-and-frozen-heldout-workflow"></a>

## New live experiment

Consult `node scripts/experience.mjs --help` and the limits in [experiment-ledger.mjs](../scripts/benchmark/experiment-ledger.mjs) before requesting spending approval. Use a new experiment state directory and a new plan path, never the retained historical plan. Live phases require `--mode=live --allow-paid=yes`, fix `deepseek-v4-flash` at the official endpoint and read only the supplied `DEEPSEEK_API_KEY` reference. Never put credentials in arguments or reports.

Run `development`, `training`, `lifecycle` and `recovery` in order, reusing the exact same `--state=PATH`. The ledger reserves before transport, including failed calls, and preserves evaluation capacity. Missing/corrupt ledgers, unfinished runs and repeated claimed phases fail closed; do not reset state to regain budget. `--phase=status` reads safe accounting without credentials. A separately identified retry attempt requires an explicit decision, retains the original evidence and consumes the same ledger.

Development must establish exact-state feasibility before training. Lifecycle and recovery must prove accepted guidance exclusion, canonical and actual-wire promotion, exposure-scoped outcomes, rollback, replay and disposal. These gates do not certify strategy quality.

After they pass, use `--phase=freeze --plan=PATH` with the same live options to write a new plan without model calls. Review and commit the plan locally before `--phase=evaluation --plan=PATH`. Evaluation rejects uncommitted/changed plans, altered implementation or seed journals and mode mismatches before reading credentials. Freeze task membership, ordering, candidates, budgets, oracle and reporting before heldout use; no post-heldout tuning or replacement is part of that experiment.

The [legacy runner](../scripts/benchmark.mjs) remains pilot-only; its `--help` describes offline/fixture/live modes. Limits live in [report.mjs](../scripts/benchmark/report.mjs) and [transport.mjs](../scripts/benchmark/transport.mjs); it cannot run heldout DeepSeek tasks. All paid controllers disable automatic retries, reject endpoint overrides and keep reservations distinct from reported usage. Input bounds are conservative admission estimates, not guaranteed billing-token ceilings. Killing a timed-out child does not prove remote cancellation or stopped billing.

## Retained evidence and next decision

The [2026-09-06 pilot](pilot-result-2026-09-06.md) reported 0/3 success in both arms. A later regression isolated a result-renderer defect; the original negative report remains unchanged, and repaired rendering does not retroactively validate it.

The [2026-09-08 experience result](experience-result-2026-09-08.md) and its [frozen plan](experience-heldout-v1.json) preserve lifecycle provenance and six both-successful heldout pairs. The zero success-rate delta is ceiling-limited, not evidence of a gain. Those files are historical evidence, not templates to overwrite.

The next effectiveness study should use tasks with room to distinguish strategies, freeze candidates before evaluation and preserve costs and failures. Runtime or dependency upgrades need offline acceptance, not paid reruns or revised historical conclusions.
