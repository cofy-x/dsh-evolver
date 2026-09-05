# Local validation and development priorities

The next milestone is a reproducible runtime experiment with evidence at the model-request boundary. Existing keyless tests validate the service, store, Cordis event adapter, and a minimal real Loader tree. The plugin test supplies an Agent double and emits tool events directly; the Web/Headless composition fixtures mount the same minimal tree with different profile labels. They do not yet boot both shipped application profiles or execute the real agent loop. A passing suite must not be reported as live DeepSeek E2E evidence.

## Keyless runtime experiment

Create an isolated temporary DSH home, Session store, Evolver data directory, and workspace. Boot the shipped Headless profile with the local built Evolver plugin, a scripted adapter registered through the public LLM service, and one harmless test tool. Use the real Agent registry, loop, tool pipeline, commands, and Session persistence. Do not import private Harness test helpers into product code or mix workspace and published versions of the same Cordis service.

Run a deterministic sequence: two tool failures with equivalent redacted summaries produce two observations, one pattern, and one pending proposal; pending guidance is absent from actual adapter requests; command-driven acceptance and promotion cause guidance to appear in a fresh Session's canonical history and adapter request; a successful exposed tool call contributes treatment; rollback removes guidance from the next fresh Session; reopening the store preserves counts, generation, and the frozen evaluation. Assert call counts and audit facts instead of relying on the assistant's narrative. A second application-profile smoke should use the shipped Web bundle without requiring interactive browser operation.

## Opt-in DeepSeek smoke

After the keyless runtime experiment passes, replace only the scripted adapter with the DSH DeepSeek adapter. Resolve `DEEPSEEK_API_KEY` through the existing DSH credential/environment seam, without printing it or copying it into a profile file. Select an explicitly configured model supported by the installed adapter. Use synthetic tasks and the harmless test tool only, with no shell, source repository access, background jobs, or external tools.

Start with one complete lifecycle, a proposed cap of eight model requests, 512 output tokens per request, no automatic retries, and a two-minute overall deadline. Count requests in the harness and cancel the Agent when a budget is exceeded. These are proposed runner limits, not implemented configuration flags; an output cap alone does not bound input-token cost. Save only redacted assertions, usage totals, versions, exact commits, and pass/fail evidence. Keep real API tests outside credential-free CI and require explicit authorization before spending the API budget.

This smoke proves tool execution, collection, review, injection, and measurement wiring. It cannot prove learning quality: the current proposer supplies generic diagnostic guidance. A later paired task benchmark should hold task fixtures and model configuration fixed, compare baseline and promoted runs across multiple seeds/tasks, and report task success, retries, tokens, latency, and uncertainty independently from the plugin's tool-level failure-rate heuristic.

## Priority order

1. Complete the keyless real-runtime experiment, then the bounded live smoke.
2. Define fresh read/injection semantics for multiple runtimes and awaitable exposure accounting before adding an independent CLI or worker.
3. Add cancellation and deadlines to the provider contract before any external verifier or LLM proposer.
4. Measure replay/write latency against realistic failure logs; select persistence changes from those results.
5. Introduce a bounded strategy catalogue and paired effectiveness benchmark before broader proposal generation or UI work.
