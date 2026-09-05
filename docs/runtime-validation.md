# Shipped runtime evidence

## Running the integration gate

Run `pnpm run test:runtime` with a built sibling Harness checkout, or build Evolver and run `node scripts/runtime-e2e.mjs <harness-checkout>`. This separate gate requires Node 24, installed host workspace dependencies, built public exports, and Web frontend assets. Missing/stale host builds fail; there is no fallback to a minimal fixture. The resolver routes all DSH/Cordis imports, including Evolver peers, through that checkout's public package exports. No private test helpers or source imports are used.

The real `loadProfile` and `boot` load shipped Headless and Web patches. Headless executes its one-shot launcher; the exit callback is intercepted to continue the lifecycle in the same live tree. Web retains its application, server, connection, upload, and controller composition and starts with `--no-open --port 0`. It is a noninteractive startup smoke, not a browser/WebSocket or second lifecycle test.

Each profile has temporary DSH home, agent home, workspace, configuration, Sessions, and Evolver data. Children inherit an explicit environment allowlist, not credentials, proxies, or Node options. The real credentials service sees only empty temporary locations and scrubbed environment. Test overlays disable production tools, model adapters, retries, title generation, telemetry, and filesystem instructions/skills. One side-effect-free probe and a scripted public LLM adapter replace those edges; real Agents, loop, tool pipeline, commands, and Session persistence remain. Outbound fetch/TCP/HTTP/TLS fail and their attempted use fails assertions. This guard is not an OS sandbox against hostile plugins.

The request ceiling is 20 per child; the wall-clock ceiling is 60 seconds including teardown. Deadline termination fails the run, kills the child, and cleans temporary files; it is not successful disposal. Success requires explicit fiber/Agent disposal and natural process exit. The recovery child shares only persisted temporary state with the scenario child. Transient Web URL tokens are redacted from reported output.

## Evidence

Successful execution: Headless scenario 12 scripted adapter requests, separate Headless recovery 1, Web startup 0. All three children reported zero network attempts and exited normally. The fast suite passed 50 tests across six files.

- Real failures: two observations, one pattern, exactly one pending proposal, and no guidance in actual adapter requests.
- Real accept command followed by a fresh Session: accepted guidance still absent.
- Real promote command: guidance appears in fresh Session canonical `user/message` events and actual adapter requests.
- Exposed success adds one treatment sample; success in the older unexposed Session adds none.
- Real rollback: a fresh Session and request contain no guidance.
- Store reopening and separate Headless restart preserve occurrence 2, generation 1, superseded proposal, and identical frozen evaluation. The recovery process reads the treatment Session through public Session persistence and finds canonical guidance.
- Audit JSONL excludes private argument, full output, and password sentinels.
- Evolver disposal removes its command; another real tool failure adds no observation. Fixture disposal removes the probe. Root disposal removes the Agent service and exits without unfinished writes or handles.

The fast suite also covers fail-closed corrupt replay, legacy logs, transitions, idempotency, and admission races. Its older two-label minimal Loader fixture is not counted as shipped-profile coverage.

## Environment and host preparation

Executed on macOS, Node `v24.16.0`, pnpm 11, Harness `0.1.3-alpha.1` at source SHA `d347e703908d0406b7a7ef80e3a0e594d86b2215`. Structural-only product commit: `5e93ffc5054c688de3a74fb7c64c05904a30a64e`; the next behavior/integration commit contains this evidence. Fast tests use locked published DSH `0.1.2-rc.1` peers; runtime tests use only the host checkout, not a mixture.

The existing local Web build was stale: session-controller referenced the removed Session `chunk-rows` subpath, file-upload lacked a build, LLM lacked `AssistantStreamAccumulator`, and commands lacked `registerFileReceiptResolver`. Rebuilt only related ignored outputs from the above source: session-controller host, file-upload host/client, LLM host, commands host. Harness tracked source remained unchanged. Fresh environments must build public exports and Web assets first. Dependency preparation can require network; integration children must report zero network attempts.

## Timing, consistency, and shutdown

Injection now happens before exposure is queued. A regression rejects synchronous `agent.inject()` and proves it cannot create a false exposure. Another rejects the exposure write: queued guidance remains, a warning is emitted, and no treatment is attributed. The real single-runtime scenario covers successful queue ordering. This is not an atomic transaction across Session and Evolver: a crash or asynchronous storage failure can leave guidance without durable exposure.

Next design: an awaitable pre-request boundary with injection identity and canonical Session reference, durable exposure intent, canonical acknowledgment, and confirmed exposure before model execution. Recovery must reconcile interrupted intents. Acceptance requires crash/failure injection at every await boundary, no false treatment, and no request before the agreed durability barrier. That host integration protocol is outside this local refactor.

A two-runtime regression proves rollback in A leaves B's synchronous snapshot stale until B performs a transaction. Locked admission still replays the latest log, but injection is not cross-runtime fresh. Use one active runtime per directory. Next design: an explicit fresh-read/injection revision boundary, tested with two processes racing rollback and Session start. Specify in-flight semantics; already-canonical guidance cannot be revoked from existing history.

Reservation expiry permits ownership recovery and fences stale completion; it does not cancel providers. A regression holds a provider unresolved, expires/reclaims its reservation, and proves disposal remains pending until the old provider settles. Next provider contract: AbortSignal, deadline, stale-result fencing, and bounded shutdown policy. Acceptance must cover cooperative and abort-ignoring providers, no commits after disposal, and bounded teardown. Arbitrary never-settling providers remain unsupported; the current deterministic provider performs no external work.

See [validation plan](validation-plan.md) for the credential-gated DeepSeek proposal and the distinction between correct wiring and measured task improvement. No key was read or paid request issued in this stage.
