# AGENTS.md

## Repository purpose

`dsh-evolver` is the independent DSH-native engine for auditable, verifier-gated agent self-evolution. It owns bounded observations, evolution proposals, verification evidence, human review, promotion state, and the read-only projection of promoted strategy guidance. DeepSeek Harness owns Agents, canonical Sessions, tools, commands, skills, credentials, permissions, and model execution.

## Product boundaries

- Default behavior creates proposals; it never edits DSH core, plugin source, user code, evaluator logic, approval policy, safety policy, or verifier configuration.
- Every model-visible promoted strategy enters through a public DSH logged channel. Do not add unlogged request mutation.
- Collect only bounded, redacted evidence and canonical Session references. Never copy complete Session events, reasoning, tool arguments, credentials, or complete tool output into Evolver storage.
- Verification supplies evidence and a decision. Only a separate human review operation may accept or reject, and only an accepted proposal may be promoted.
- Do not execute commands obtained from observations, proposals, shared assets, or model output.
- Keep the core offline. Network sharing, EvoMap, automation, LLM proposal generation, and UI integrations are optional future adapters.
- Use public DSH services and extension events. Do not patch `agent-loop` or import private Harness source paths.
- All Cordis registrations must be effect-owned and must disappear after plugin disposal. Disposal stops new mutations and waits for admitted persistence work.

## Clean-room and licensing

This project is an MIT-licensed clean-room implementation. EvoMap/evolver is acknowledged as prior art, but its source code, prompts, private formats, and GEP naming are not implementation inputs. Do not claim affiliation, endorsement, portability, or protocol compatibility without an explicit later review.

## Engineering

Use Node.js 24 or newer for development, pnpm 11, strict TypeScript, and ESM. Validate configuration, command input, and persisted JSONL at their entry points. Opaque persisted identifiers stay branded. Store changes preserve the versioned append-only event vocabulary, atomic replacement, owner-only file permissions, and fail-closed replay.

Keep Markdown prose paragraphs on one physical line. Public interfaces and non-obvious modules require accurate JSDoc. Do not commit build output, dependencies, local state, credentials, private endpoints, or absolute developer paths.

English documents are authoritative. When an English document with a `.zh.md` counterpart changes materially, update the Chinese counterpart in the same change. Keep commands, identifiers, limits, commit SHAs, and safety boundaries identical across languages; do not maintain independent roadmaps in translations. Use [`docs/README.md`](docs/README.md) as the documentation map instead of duplicating status across files.

## Context and documentation

Start with README, then load only the relevant page from [the documentation map](docs/README.md). Keep durable behavior and constraints in architecture, executable procedures in runbooks, and current facts in code/configuration. Read live Git state before interpreting evidence.

Do not duplicate module implementations, completed plans, passing-test counts, local build-repair logs, or speculative adapter lists across documents. Preserve concise negative findings and decision-relevant experimental provenance. Update existing pages before adding new ones; keep English and Chinese claims aligned.

## Verification and delivery

Use the [verification guide](docs/runtime-validation.md) to select standard and boundary-specific gates. Documentation-only changes require formatting, link checks, and staged/unstaged diff review. Record what was actually verified.

The current verifier is an offline structural safety check; it is not `dsh-as-a-verifier` integration or proof of task effectiveness. Paid smoke and benchmark runs require explicit model and aggregate-budget authorization and the documented opt-in controls. Keep credentials and raw provider output out of reports.

Local commits are allowed after applicable gates pass. Remote pushes use Hangar's `devbox-x` workflow. Releases, tags and npm publication require explicit authorization.
