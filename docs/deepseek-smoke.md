# Opt-in DeepSeek smoke runner

The runner supports both offline adapter checks and explicitly authorized live execution. The first authorized live lifecycle and separate recovery passed on 2026-09-06; see the recorded evidence below. Offline mode still exercises the shipped DeepSeek adapter, wire serialization, SSE parsing, and usage mapping without real credentials or network.

## Entry points and prerequisites

From the product checkout, `node scripts/runtime-e2e.mjs --help` is the authoritative CLI reference. `pnpm run test:deepseek-offline` builds Evolver, runs the real adapter with local SSE, then verifies HTTP 429 and an unending transport. It requires the same built sibling Harness public exports as [runtime validation](runtime-validation.md). No core source changes, private test helpers, network access, or real credentials are needed. An optional positional checkout path is supported by the runner; the convenience package script uses the sibling checkout.

Live execution requires all three options `--deepseek-live --allow-paid --model=ID` and a previously supplied `DEEPSEEK_API_KEY` environment variable. Choose and confirm the actual model ID before execution. The runner validates arguments before reading that one variable; it never inherits other user credentials, proxies, endpoint overrides, or Node options. Do not put a literal key in shell history or profile YAML. Invalid/missing authorization fails before boot. This document is not authorization to spend; ask the user first.

Writes are limited to a temporary home/workspace, canonical Session files, Evolver audit, budget ledger, and small phase reports. They are removed after success or failure. Live child stdout/stderr are discarded rather than attempting best-effort secret redaction. Only structured pass/fail, model, per-phase usage, cumulative reservations, source SHAs/dirty flags, and runtime version evidence reaches the parent output. Preserve that summary externally if desired; no transcripts, raw provider errors, or credential values are retained as evidence.

## Shared scenario, different provider edge

Default mode remains the scripted provider with shipped Headless and Web startup. DeepSeek modes run the same Headless scenario and separate restart only: pending/accepted request exclusion, real accept/promote commands, canonical guidance and serialized wire guidance, exposed versus unexposed treatment, rollback, audit privacy, persistence recovery, and disposal. Each turn asserts actual probe calls and arguments against its synthetic contract, so a live model stopping early, adding calls, or ignoring instructions fails rather than being patched with fabricated events.

Both DeepSeek modes enable `llm-deepseek` through its public plugin entry and select `deepseek-official` for all Agents. An effect-owned public complete system-prompt section supplies a short synthetic tool protocol. This is a smoke-specific prompt, not a claim to test the full default coding prompt. The existing credentials service resolves either the caller's authorized environment key or an unmistakable offline fixture sentinel. No real key is read in dry-run mode.

The adapter is configured with thinking disabled, reasoning off, 512 output tokens, 15-second stream idle timeout, and provider retry policy `normal` with `maxRetries: 0`; the outer retry plugin is also disabled. Session-log and local package-inventory request extensions are disabled, alongside the existing production tools/telemetry/title-generation overlays. Only the harmless probe is exposed. Wire admission rejects unknown extension fields and non-text message content.

## Budgets and network boundary

`budget.mjs` is the single source of limits: at most 16 reserved HTTP requests across both processes, 512 output tokens per request, 8,192 total reserved output tokens, 4,096 input admission units per request, and 32,768 total input admission units. Requests are charged synchronously before transport, including failed requests. Recovery loads the same temporary ledger; it cannot reset the aggregate allowance. Every successful adapter call must report exactly one valid usage record, and no hidden/retry HTTP calls are allowed. Usage above the per-request or phase limits stops the scenario; reserved aggregate limits remain authoritative across phases.

Input admission deliberately charges the full serialized UTF-8 byte length plus 256 framing units and 32 per message, including schemas and serialization overhead. This is a conservative byte-BPE estimate with headroom, not a verified provider tokenizer or a guaranteed billing-token ceiling. The current fixture fits without raising the planned allowance. Before paid execution confirm the selected tokenizer assumptions and price with the user; if exact billing bounds are required, integrate that tokenizer first. Longer real replies can exhaust input admission early and correctly fail the smoke.

Only an exact POST to `https://api.deepseek.com/chat/completions` is accepted; custom endpoints, query strings, redirects, files, and model discovery requests are denied. Dry-run blocks socket/TLS access and supplies local SSE. Live mode uses native fetch with request cancellation signals and a 15-second request deadline, allows TLS only to the fixed host/port, and blocks direct HTTP(S) request helpers. This is an application guard over trusted shipped plugins, not an OS firewall: live native fetch still needs TCP/DNS and an untrusted module could bypass JavaScript guards. No tools capable of network or filesystem access are exposed.

The parent enforces 120 seconds total across startup, scenario, recovery, and teardown; `--timeout-ms` can only lower it. Native fetch also receives the Agent signal plus the earlier request/run deadline. A stuck or abort-ignoring child is killed and classified as failure, with its temporary state removed. Killing a process is not proof that an external provider stopped work or stopped billing; Evolver's provider cancellation/disposal contract remains unchanged.

## Executed evidence and remaining verification

On Node `v24.16.0`, Harness `0.1.3-alpha.1` source SHA `d347e703908d0406b7a7ef80e3a0e594d86b2215`, the real-adapter offline lifecycle used 12 requests and restart used 1. Cumulative reservations were 27,540 input units and 6,656 output tokens. Fixture-reported usage was 1,300 input and 130 output tokens, intentionally synthetic and not a measured cost. HTTP 429 produced exactly one reservation with no retry. An unending fake transport produced one reservation, hit the lowered four-second parent deadline, and failed with bounded termination. Unit checks cover reservation restoration, rejected requests, Unicode size, endpoint restrictions, and authorization/privacy CLI failures.

## Authorized live result — 2026-09-06

The user explicitly authorized using the existing environment configuration and paid live smoke. Only `DEEPSEEK_API_KEY` was present among DeepSeek environment settings; no model or endpoint override was configured. The run selected `deepseek-v4-flash` at the fixed official endpoint with thinking disabled, zero retries, and unchanged budgets. Credential values and raw child output were not reported or retained. One invocation succeeded; no paid rerun was necessary.

| Phase                     | Requests | Reported input tokens (including cache) | Reported output tokens |
| :------------------------ | -------: | --------------------------------------: | ---------------------: |
| Full lifecycle            |       12 |                                   7,062 |                    361 |
| Separate-process recovery |        1 |                                     450 |                      1 |
| Total                     |       13 |                                   7,512 |                    362 |

Both phases reported `passed: true`. Cumulative admission reservations were 27,976 input units and 6,656 output tokens, below the unchanged 32,768/8,192 limits. The run completed within the 120-second deadline and exited normally after teardown. Usage is provider-reported, not a billing invoice; no monetary cost is inferred from these totals.

Tested product SHA: `d9de4ed6f2a571737d6fdde1633a7d77f5346e79`, clean worktree. Harness SHA: `d347e703908d0406b7a7ef80e3a0e594d86b2215`, clean worktree, version `0.1.3-alpha.1`; Node `v24.16.0` on macOS. This documentation-only follow-up records those tested revisions rather than claiming its own commit was the paid test target.

All shared scenario assertions passed against real model requests: exact synthetic tool failures and aggregation; pending/accepted guidance exclusion; command-driven promotion and canonical/serialized guidance; exposure-only treatment; rollback; frozen evaluation and canonical Session recovery; audit sentinel exclusion; and disposal. This establishes successful authentication, TLS/endpoint/model compatibility, real streaming/tool-call formatting, and tool-following for this synthetic run. It does not prove remote cancellation, an authoritative preflight tokenizer bound, or that strategies improve task success. Effectiveness still requires a separate held-out paired benchmark.
