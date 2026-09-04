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

## Verification and delivery

Run before commit:

```sh
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
pnpm pack --dry-run
git diff --check
```

Product-visible changes require a real Loader composition test. Model-visible guidance requires keyless snapshot evidence. Persistence changes require restart, corruption, transition, and idempotency tests. Local commits are allowed after gates pass; remote pushes use the Hangar `devbox-x` workflow. Do not create releases, tags, or npm publications without explicit authorization.
