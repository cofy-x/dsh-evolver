# Local validation and development priorities

The credential-free runtime experiment is implemented in `scripts/runtime-e2e.mjs`; see [runtime evidence and boundaries](runtime-validation.md) for executed coverage, prerequisites, and remaining limitations. The older Vitest composition fixtures still mount a minimal tree with two labels and are not shipped-profile evidence. No test in this stage calls a live DeepSeek model.

## Keyless runtime scenario (implemented)

Create an isolated temporary DSH home, Session store, Evolver data directory, and workspace. Boot the shipped Headless profile with the local built Evolver plugin, a scripted adapter registered through the public LLM service, and one harmless test tool. Use the real Agent registry, loop, tool pipeline, commands, and Session persistence. Do not import private Harness test helpers into product code or mix workspace and published versions of the same Cordis service.

Run a deterministic sequence: two tool failures with equivalent redacted summaries produce two observations, one pattern, and one pending proposal; pending guidance is absent from actual adapter requests; command-driven acceptance and promotion cause guidance to appear in a fresh Session's canonical history and adapter request; a successful exposed tool call contributes treatment; rollback removes guidance from the next fresh Session; reopening the store preserves counts, generation, and the frozen evaluation. Assert call counts and audit facts instead of relying on the assistant's narrative. A second application-profile smoke should use the shipped Web bundle without requiring interactive browser operation.

## Opt-in DeepSeek smoke

After the keyless runtime experiment passes, replace only the scripted adapter with the DSH DeepSeek adapter. Resolve `DEEPSEEK_API_KEY` through the existing DSH credential/environment seam, without printing it or copying it into a profile file. Select an explicitly configured model supported by the installed adapter. Use synthetic tasks and the harmless test tool only, with no shell, source repository access, background jobs, or external tools.

Start with one complete lifecycle plus recovery, at most 16 model requests (the scripted reference uses 12 plus 1), 512 output tokens per request and 8,192 aggregate output tokens, 4,096 input tokens per request and 32,768 aggregate input tokens, no automatic retries, and a two-minute overall deadline including shutdown. Enforce input bounds before transmission using the selected model's tokenizer or a conservative byte-based bound; usage reporting alone is not a cost limit. Stop admission and abort the Agent/request when a budget is exceeded; a subprocess deadline must fail an abort-ignoring run. These are proposed runner limits, not implemented configuration flags. Save only redacted assertions, usage totals, versions, exact commits, and pass/fail evidence. Keep real API tests outside credential-free CI and require explicit authorization before spending the API budget.

The concrete adapter swap uses the shipped `llm-deepseek` entry with `apiKeyEnv: DEEPSEEK_API_KEY`, `thinking: disabled`, `reasoningEffort: off`, `maxTokens: 512`, and `streamIdleTimeoutMs: 15000`. Both `agent-default-model` and explicitly created Agents select provider `deepseek-official` and a user-confirmed model ID from the installed adapter catalog. The credentials service resolves that environment reference per request. Retain the lifecycle, real commands, synthetic probe, privacy assertions, and Session recovery; add turn-specific synthetic instructions and a budget-counting wrapper around the real adapter. Replace the offline network guard with an explicit endpoint allowance only in the opt-in runner. A model choosing the wrong tool is a model-contract failure, not permission to fabricate tool events. Confirm current model/pricing and token bounds before enabling the run.

The scripted run proves tool execution, collection, review, injection, and measurement wiring. Only a live smoke can validate authentication, current endpoint/model compatibility, actual streaming/tool-call formatting, and whether that model follows the synthetic contract. Neither proves learning quality: the current proposer supplies generic diagnostic guidance. A later paired task benchmark should hold held-out fixtures and model configuration fixed, compare baseline and promoted runs across multiple runs/tasks, and report task success, retries, tokens, latency, and uncertainty independently from the plugin's tool-level failure-rate heuristic.

## Priority order

1. Prepare the opt-in budgeted runner using the passing keyless scenario, then obtain authorization for the bounded live smoke.
2. Define fresh read/injection semantics for multiple runtimes and awaitable exposure accounting before adding an independent CLI or worker.
3. Add cancellation and deadlines to the provider contract before any external verifier or LLM proposer.
4. Measure replay/write latency against realistic failure logs; select persistence changes from those results.
5. Introduce a bounded strategy catalogue and paired effectiveness benchmark before broader proposal generation or UI work.
