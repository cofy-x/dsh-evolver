# Real experience and heldout result — 2026-09-08

[English](experience-result-2026-09-08.md) | [简体中文](experience-result-2026-09-08.zh.md) | [Procedure](paired-benchmark.md) | [Frozen plan](experience-heldout-v1.json)

The real DSH experience → proposal → verification → public human-review commands → promotion → independent task evaluation → rollback/recovery path is operational in isolated experimental homes. All six heldout pairs succeeded in both arms, with no invalid pairs: **baseline 6/6, treatment 6/6, success-rate delta 0**. This is a ceiling result, not evidence that the generic strategy improves success, establishes equivalence, or generalizes to production tasks. No additional live run was made after these results.

## What caused the earlier failure?

The [original 2026-09-06 pilot](pilot-result-2026-09-06.md), including both arms' 0/3 result, remains unchanged. A credential-free reproduction established a concrete experiment bug: the public tool renderer receives `(args, value)`, but the old benchmark supplied a one-argument renderer and therefore returned arguments instead of the successful tool-body result. Its white-box model fixture knew the answers independently and masked the semantic loss. Earlier request-equality checks did not prove correct tool-result delivery. This is an experiment-driver defect, not a demonstrated DSH core defect.

The new `recovery-protocol-v2` uses the correct renderer and explicit legal action/payload descriptions without exposing the grader or hidden values. Diagnostics check body → rendered result → subsequent adapter options → actual serialized wire, retaining bounded action/error/progress/delivery facts only. The task bank and exact-state grader are unchanged. Because renderer, schema and per-run budget differ from the original pilot, the new results do not isolate their individual causal contributions or establish the renderer as the sole cause of all original failures.

The first new development attempt exposed another experiment assertion bug: successful outcomes outside evaluation windows legitimately produce no audit journal. Both executed goals were reached, but the experiment marked them invalid; two consecutive invalid runs stopped the third task. The original report was retained. After an offline success-only regression, explicit attempt 2 wrote a separate report in the same ledger. Its batch task reached the exact goal and then requested another inspection, exhausting six requests before normal completion. It remains a budget failure, not a retroactively successful run. This supports bounded stopping/model-behavior concerns rather than a continuing result-delivery defect.

## All pre-heldout planned runs

P/F/B denote the `development-precondition-1`, `development-format-1`, and `development-batch-1` fixtures. “Goal” is exact simulated state, while success also requires normal bounded termination. Token columns are provider-reported input including cache tokens, and output. A dash means not started, not a fabricated measurement.

| Phase / task                    | Status                       | Goal | Requests | Input / output tokens |
| :------------------------------ | :--------------------------- | :--- | -------: | --------------------: |
| Development 1 / P               | Invalid: runtime assertion   | Yes  |        3 |           2,051 / 169 |
| Development 1 / F               | Invalid: runtime assertion   | Yes  |        4 |           3,037 / 317 |
| Development 1 / B               | Not run: infrastructure stop | —    |        — |                     — |
| Development 2 / P               | Completed                    | Yes  |        5 |           4,275 / 553 |
| Development 2 / F               | Completed                    | Yes  |        3 |           2,108 / 235 |
| Development 2 / B               | Failed: request budget       | Yes  |        6 |           5,587 / 647 |
| Training / P                    | Completed                    | Yes  |        4 |           3,850 / 642 |
| Training / F                    | Completed                    | Yes  |        4 |           3,363 / 584 |
| Training / B                    | Completed                    | Yes  |        6 |           6,094 / 738 |
| Lifecycle / P, including probes | Completed                    | Yes  |       12 |           9,822 / 671 |
| Separate-process recovery / P   | Completed                    | Yes  |        5 |           4,048 / 425 |

Development 2's failed batch sequence was `inspect → commit(batch-limit) → commit → inspect → commit(goal reached) → inspect → request-budget`. Its delivered results passed semantic checks; the final inspection had no subsequent wire request because admission stopped. Development 2 / P also recovered from one `stale-revision` failure. Neither development attempt was relabeled or replaced in the recorded denominator. All three development exact-state goals were feasible; strict development completion was 2/3, and the separate controlled training drills subsequently completed 3/3 within the same six-request bound.

## Real experience and review provenance

Each training prompt requested a deliberately invalid development operation and recovery. The real model chose the actual tool calls; format and batch inspected before attempting the invalid write. These are controlled failure drills, not naturally sampled production failures. Public final `tools/result` events, not direct synthetic `observeToolFailure()` calls, admitted observations and generated candidates. The unchanged deterministic generic template refers conditionally to the observed tool/error; this does not learn a new recovery algorithm or introduce a recovery catalogue.

| Failure code         | Accepted candidate                     | Generation / admitting occurrence |
| :------------------- | :------------------------------------- | :-------------------------------- |
| `STALE_REVISION`     | `a2325035-5fee-4478-b64a-caa69f3c1b12` | 1 / 1                             |
| `UPPERCASE_REQUIRED` | `5be29abd-cb87-4146-8c97-08b99f3b6634` | 1 / 1                             |
| `BATCH_LIMIT`        | `7a0901f1-9f30-4a9a-b7f1-8f5d35c05c65` | 1 / 1                             |

The frozen plan records their observation and pattern IDs, verifier identity, seed-journal and guidance hashes. `deterministic-safety-v1` passed its offline structural checks; that is not effectiveness verification or `dsh-as-a-verifier` integration. Public `/evolve accept` commands simulated human acceptance in isolated homes; product behavior did not become automatic acceptance or promotion.

Using the real precondition candidate, lifecycle execution verified accepted guidance exclusion, public promotion, guidance in a fresh Session's canonical history and actual request, exactly one exposed treatment outcome, and no treatment contribution from a pre-existing unexposed Session. Public rollback excluded guidance from a later Session. After Evolver disposal, the independent test tool still processed a real model-requested failure while the journal remained byte-identical and the command registration was absent. A separate process replayed exact patterns, proposals, observation count and evaluations before new activity and injected no superseded guidance. Evaluation arms independently used the same public promotion boundary for every family.

Generic guidance remains conditional text, not enforced semantic task routing or cross-pattern deduplication. Experimental homes contain only the relevant family's accepted seed, so this does not validate a mixed production strategy library. The existing single-runtime storage, exposure durability and cross-store limitations in [architecture](architecture.md) remain.

## Frozen heldout outcomes

The plan was committed as `9aa7254d78e59ff7466ff54a5037d89ef0d4b4af` before any heldout request. Its hash is `87a99d8f2bce5a7fb4c0ba7ee8f9e44ea2b746ac452a3c529d7952409c64128b`. Six pairs cover heldout instances 1 and 2 of each family, with schedule seed 17 and alternating arm order. Every arm had six requests, ten admitted tool operations and 90 seconds maximum, subject to the shared 30-second request deadline and ledger. No retry, replacement, strategy/grader change, invalid run, timeout or unstarted heldout arm occurred.

Every row below represents two completed, exact-goal-successful arms. Values are baseline / treatment; input/output are actual tokens, not admission units. Latency is child elapsed time including startup and teardown, not provider-only latency.

| Heldout task   | Requests | Tool calls |    Input tokens | Output tokens |      Elapsed ms |
| :------------- | -------: | ---------: | --------------: | ------------: | --------------: |
| batch-2        |    6 / 6 |      5 / 5 |   5,600 / 5,831 |     624 / 578 |   8,735 / 6,833 |
| precondition-1 |    3 / 3 |      2 / 2 |   2,140 / 2,330 |     270 / 260 |   3,750 / 3,341 |
| precondition-2 |    5 / 3 |      4 / 2 |   4,102 / 2,285 |     443 / 212 |   5,783 / 2,764 |
| batch-1        |    6 / 6 |      5 / 5 |   6,077 / 6,036 |     679 / 579 |   7,269 / 6,948 |
| format-1       |    3 / 3 |      2 / 2 |   2,082 / 2,277 |     203 / 244 |   4,493 / 3,881 |
| format-2       |    3 / 3 |      2 / 2 |   2,144 / 2,305 |     256 / 236 |   3,936 / 3,430 |
| Total          |  26 / 24 |    20 / 18 | 22,145 / 21,064 | 2,475 / 2,109 | 33,966 / 27,197 |

All six pairs passed first adapter-options and wire equality after removing only promoted guidance, initial-state/accepted-seed/guidance identity, canonical/request exposure, privacy, result delivery and disposal checks. All treatment Sessions actually saw the selected candidate; baseline Sessions did not. The only heldout tool failure was one baseline `batch-limit` in batch-2; it recovered. No identical invalid call was repeated. A lower failure count is not the primary success metric.

The paired counts are six both-successful and zero treatment-only, baseline-only, both-failed or invalid. Treatment used two fewer requests and tool calls, 1,081 fewer input tokens and 366 fewer output tokens in this sample; the request difference came from precondition-2's extra baseline inspections. Input reservations were 84,958 / 83,681 units. These are descriptive cost observations from six single pairs, not reliable causal efficiency gains. There is no success-rate improvement evidence and no post-result tuning was performed.

## Shared budget and retained evidence

All new live phases used the same `.cache/experience-20260908` ledger: **102 requests**, **342,534 reserved input admission units**, **104,448 reserved output tokens**, **87,444 reported input tokens including cache**, **9,565 reported output tokens**, and **144,570 ms cumulative live-child wall time**. Every request has a usage report; none was retried. The frozen evaluation used 50 of those requests. The ledger retains 58 unused slots; authorization was a ceiling, not a spending target. The old pilot's separate 24 requests are not counted as new-task requests.

These totals are below the authorized 160 requests, 1,310,720 input admission units, 163,840 reserved output tokens and 20 minutes. Each request was admitted before transport, with maxima of 8,192 input admission units, 1,024 output tokens and 30 seconds. Input admission units are conservative bytes plus overhead, not actual tokens or money. Process deadlines do not establish provider-side cancellation or billing finality.

Safe reports and bounded accepted/recovery journals remain in the ignored state directory; raw Sessions, tool arguments/results and model transcripts were temporary and removed after each child. No user source, real Session library or credential was copied into Evolver storage. The retained report byte hashes are:

| Report                | SHA-256                                                            |
| :-------------------- | :----------------------------------------------------------------- |
| `development.json`    | `90602eb6dd4bd90cd58a8310730c9cfe063f826c108fda36f40fbadbcd760714` |
| `development-r2.json` | `503d5475602662c7489b423eee910597c7c961cfc241439bca1f7d0650367bf3` |
| `training.json`       | `44d5e742a0dc7d0bb438adc08a025ff0655077446eabcddb8f1fed02147820cb` |
| `lifecycle.json`      | `48b7f4a92fe6c7faedf2d18038b8543ac54efa79270df0bc34b2aa713de63db0` |
| `recovery.json`       | `0233f61d78a154c345613e57c64b9f1da4187deb1f5f5f7b1d62484899da32b1` |
| `evaluation.json`     | `811d10797cd73cb999870f653a934c630869dc2178ee2587ce50b401ecf2364d` |

## Reproduction and scope

Run `pnpm run test:experience` from a locked, built development checkout for the complete credential-free loop and fault tests. The explicit live commands, same-ledger requirement and commit-before-evaluation gate are in the [procedure](paired-benchmark.md#real-experience-and-frozen-heldout-workflow). Already-claimed live phases cannot be replayed over this evidence; another paid experiment requires its own declared version and applicable authorization, not a reset of this task's budget.

Execution environment: macOS 26.5.2 arm64, Node `v24.16.0`, pnpm `11.7.0`; built DSH `0.1.3-alpha.1`, clean source `d347e703908d0406b7a7ef80e3a0e594d86b2215`. Development attempts used clean product commits `20049da16aadc1cf3e1a30f27755b24f8d9b6238` and `5638d72313a0b421e2a75273c9663782535022d6`; training/lifecycle/recovery used clean `bd5ad4f6cfe77381e5b67418b00309ea3a829a10`; heldout used clean `9aa7254d78e59ff7466ff54a5037d89ef0d4b4af`. The final implementation fingerprint was unchanged throughout these latter phases: `2dc7b523f2be527c547b5fa922df583902617aa5c0c3b3a2b100d442cd513549`.

Standard format/lint/typecheck/unit/build/package and public ESM checks passed, alongside shipped Headless/Web, credential-free DeepSeek adapter/fault, benchmark integrity, legacy-render diagnostics and the complete experience loop. Web was a startup check, not browser coverage. The implementation changes are experiment diagnostics, corrected/versioned protocol and reproducible controllers; product lifecycle APIs, persistence vocabulary, deterministic proposer and safety boundaries remain unchanged. No push, tag, npm publication, UI, sharing network, autonomous source modification or deployment was performed. The justified conclusion is operational wiring and task feasibility, **not demonstrated strategy effectiveness**.
