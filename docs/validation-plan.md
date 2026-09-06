# Local validation and development priorities

The credential-free runtime experiment is implemented in `scripts/runtime-e2e.mjs`; see [runtime evidence and boundaries](runtime-validation.md) for executed coverage, prerequisites, and remaining limitations. The older Vitest composition fixtures still mount a minimal tree with two labels and are not shipped-profile evidence. Credential-free tests never call a live model; the separately authorized [live smoke result](deepseek-smoke.md#authorized-live-result--2026-09-06) records the successful 2026-09-06 run.

## Keyless runtime scenario (implemented)

Create an isolated temporary DSH home, Session store, Evolver data directory, and workspace. Boot the shipped Headless profile with the local built Evolver plugin, a scripted adapter registered through the public LLM service, and one harmless test tool. Use the real Agent registry, loop, tool pipeline, commands, and Session persistence. Do not import private Harness test helpers into product code or mix workspace and published versions of the same Cordis service.

Run a deterministic sequence: two tool failures with equivalent redacted summaries produce two observations, one pattern, and one pending proposal; pending guidance is absent from actual adapter requests; command-driven acceptance and promotion cause guidance to appear in a fresh Session's canonical history and adapter request; a successful exposed tool call contributes treatment; rollback removes guidance from the next fresh Session; reopening the store preserves counts, generation, and the frozen evaluation. Assert call counts and audit facts instead of relying on the assistant's narrative. A second application-profile smoke should use the shipped Web bundle without requiring interactive browser operation.

## Opt-in DeepSeek smoke

The budgeted runner, real-adapter offline checks, and one authorized live run are complete; see [the smoke guide](deepseek-smoke.md) for entry points, controls, and evidence. Input limits remain byte-based admission estimates, not verified tokenizer counts. Future paid runs still require explicit authorization; the successful smoke is not evidence of strategy effectiveness.

After the keyless runtime experiment passes, replace only the scripted adapter with the DSH DeepSeek adapter. Resolve `DEEPSEEK_API_KEY` through the existing DSH credential/environment seam, without printing it or copying it into a profile file. Select an explicitly configured model supported by the installed adapter. Use synthetic tasks and the harmless test tool only, with no shell, source repository access, background jobs, or external tools.

The runner implements one complete lifecycle plus recovery, at most 16 model requests (the scripted reference uses 12 plus 1), 512 output tokens per request and 8,192 aggregate reserved output tokens, 4,096 input admission units per request and 32,768 aggregate input admission units, no automatic retries, and a two-minute overall deadline including shutdown. Input admission charges serialized UTF-8 bytes plus framing headroom, not authoritative provider tokens; usage reporting alone is not a preflight cost limit. Budget failure stops subsequent admission; request signals and the parent subprocess deadline bound a stuck run without claiming remote cancellation. Save only safe assertions, usage totals, versions, exact commits, and pass/fail evidence. Keep real API tests outside credential-free CI and require explicit authorization before spending the API budget.

The implemented adapter swap uses the shipped `llm-deepseek` entry and its public configuration. Both default and explicit Agent selections use `deepseek-official`; the credential reference is resolved per request. The lifecycle, real commands, synthetic probe, privacy assertions, and Session recovery are shared, with turn-specific instructions and wire-level admission. See the smoke guide for the exact provider/outer retry and request-extension controls. A model choosing the wrong tool is a model-contract failure, not permission to fabricate tool events. Confirm current model/pricing and token assumptions before enabling the run.

The scripted run proves tool execution, collection, review, injection, and measurement wiring. Only a live smoke can validate authentication, current endpoint/model compatibility, actual streaming/tool-call formatting, and whether that model follows the synthetic contract. Neither proves learning quality: the current proposer supplies generic diagnostic guidance. A later paired task benchmark should hold held-out fixtures and model configuration fixed, compare baseline and promoted runs across multiple runs/tasks, and report task success, retries, tokens, latency, and uncertainty independently from the plugin's tool-level failure-rate heuristic.

## Priority order

1. Use the passing live smoke as the wiring baseline; design a held-out paired benchmark before claiming task-effectiveness gains. Further paid runs require their own agreed budget.
2. Define fresh read/injection semantics for multiple runtimes and awaitable exposure accounting before adding an independent CLI or worker.
3. Add cancellation and deadlines to the provider contract before any external verifier or LLM proposer.
4. Measure replay/write latency against realistic failure logs; select persistence changes from those results.
5. Introduce a bounded strategy catalogue and paired effectiveness benchmark before broader proposal generation or UI work.
