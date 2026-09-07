# Authorized real adapter pilot — 2026-09-06

[English](pilot-result-2026-09-06.md) | [简体中文](pilot-result-2026-09-06.zh.md)

One explicitly authorized paid execution of [the paired pilot](paired-benchmark.md), with no retries, replacement arms, prompt/grader changes, or paid reruns. This is a negative task result, not a successful effectiveness experiment. The runtime and measurement checks passed.

## Frozen execution

Command (requires a built sibling Harness and an already-set `DEEPSEEK_API_KEY`): `node scripts/benchmark.mjs --adapter=deepseek-live --allow-paid=yes --model=deepseek-v4-flash`. Only the official endpoint was used. The key was referenced from ENV, never printed or written into configuration. No real model was used by the preceding offline gates.

Product implementation: `a185d58e41152fd440d9cdeced83ef58e1c7660d`. Harness: `0.1.3-alpha.1`, source `d347e703908d0406b7a7ef80e3a0e594d86b2215`, clean. Environment: macOS, Node `v24.16.0`. Product dirty state was true because documentation work was concurrent; executable pilot files were committed and the implementation fingerprint was unchanged throughout the experiment. No DSH core source, task bank, grader, tool schema, prompt, or proposer was changed for this run.

- Fixture hash: `a22ce6aca549d8d2506fff551f1a916bc5949aa5f913b74ce22319124665b2b6`.
- Implementation hash: `d9bae589c54a9e31186725e6203953f131520eee46f8c4999410ba5b44f9b478`.
- Plan hash: `b6452cff642db68e1240e0f58926fa3b4e5bd3871208e37decafe193987bc147`.
- Schedule seed: 17; precondition baseline/treatment, batch treatment/baseline, format baseline/treatment.

## Observed outcomes

All six arms ended with `status=budget`, `goalReached=false`, and `success=false`. Every arm admitted four model requests. No infrastructure/invalid pairs occurred: three planned and three valid pairs, all both-failed; descriptive success-rate delta was zero. Zero versus zero is a floor result, not evidence of equivalence or strategy usefulness.

| Task         | Baseline calls / failures | Treatment calls / failures | Baseline input / output tokens | Treatment input / output tokens |
| :----------- | ------------------------: | -------------------------: | -----------------------------: | ------------------------------: |
| Precondition |                     6 / 4 |                      4 / 0 |                    2,593 / 402 |                     2,626 / 277 |
| Batch        |                     6 / 0 |                      4 / 1 |                    2,740 / 500 |                     2,804 / 321 |
| Format       |                     4 / 0 |                      5 / 1 |                    2,394 / 304 |                     2,872 / 362 |

Total: 24 paid requests, 24 usage reports, **16,029 input tokens including cache tokens and 2,166 output tokens**. Reservations were 61,956 conservative input byte units and 12,288 output tokens, below the 98,304 input ceiling and at the 24-request ceiling. Driver elapsed times sum to 25,080 ms; this is not total wall time or a provider-only latency measure. No monetary cost is inferred from token counts.

All pairs passed first adapter-options and serialized-wire equality after removing only promoted guidance, as well as initial-state, accepted-seed, and guidance identity. Baseline had no guidance; treatment had guidance in both actual requests and canonical Session history. Every arm completed audit privacy and tool-disposal assertions (`validationCompleted=true`), including credential absence from Evolver audit. No forbidden network attempts occurred; the permitted official requests are counted separately above. Temporary Sessions, journals and workspaces were removed after child exit. No raw tool arguments, model output, or credentials were retained in the safe report.

## Interpretation and next decision

Fewer tool failures did not imply task completion: several arms had zero tool failures yet failed the exact-state goal. Aggregate counters alone cannot distinguish excessive inspection, incomplete writes, incorrect values, or other model choices. Raw transcripts were deliberately not retained, so this run does not support a more specific root-cause claim. Do not silently increase the budget or alter the task contract and call the rerun this same experiment.

Next, add privacy-safe diagnostic counters in a separately versioned experiment: inspect/commit/unknown-action counts, bounded validation error categories, goal-state match after admitted calls, and the precise budget stop reason. Validate those counters offline and on development fixtures. Review whether the tool's minimal schema communicates the protocol adequately; any schema/prompt change requires a new version, identical changes in both arms, a frozen plan and a separately agreed paid budget. Keep the original negative pilot result. Do not spend on heldout repetitions until basic task feasibility is established; any later effectiveness claim needs a broader frozen sample and uncertainty analysis. This pilot does not establish server-side cancellation, multi-runtime consistency, or general self-evolution effectiveness.
