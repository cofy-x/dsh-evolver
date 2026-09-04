/** Atomic JSONL audit persistence and replay. @module dsh-evolver/store */

import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  EvolutionError,
  observationId,
  proposalId,
  type EvolutionAuditEvent,
  type EvolutionObservation,
  type EvolutionProposal,
  type EvolutionState,
  type ProposalId,
  type VerificationOutcome,
} from './domain.ts'

const STORE_FILE = 'audit-v1.jsonl'

type EventBody = EvolutionAuditEvent extends infer Event
  ? Event extends EvolutionAuditEvent
    ? Omit<Event, 'schemaVersion' | 'seq' | 'at'>
    : never
  : never

interface MutableState {
  readonly observations: Map<ReturnType<typeof observationId>, EvolutionObservation>
  readonly proposals: Map<ProposalId, EvolutionProposal>
  lastSeq: number
}

function emptyState(): MutableState {
  return { observations: new Map(), proposals: new Map(), lastSeq: -1 }
}

function objectOf(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EvolutionError(`${context} must be an object`, 'CORRUPT_STORE')
  }
  return value as Record<string, unknown>
}

function stringOf(value: unknown, context: string): string {
  if (typeof value !== 'string') {
    throw new EvolutionError(`${context} must be a string`, 'CORRUPT_STORE')
  }
  return value
}

function isoOf(value: unknown, context: string): string {
  const text = stringOf(value, context)
  if (!Number.isFinite(Date.parse(text))) {
    throw new EvolutionError(`${context} must be an ISO timestamp`, 'CORRUPT_STORE')
  }
  return text
}

function verificationOf(value: unknown): VerificationOutcome {
  const raw = objectOf(value, 'verification')
  const decision = stringOf(raw.decision, 'verification.decision')
  if (decision !== 'passed' && decision !== 'failed') {
    throw new EvolutionError('verification.decision is invalid', 'CORRUPT_STORE')
  }
  return Object.freeze({
    decision,
    verifier: stringOf(raw.verifier, 'verification.verifier'),
    evidence: stringOf(raw.evidence, 'verification.evidence'),
  })
}

function observationOf(value: unknown): EvolutionObservation {
  const raw = objectOf(value, 'observation')
  if (raw.kind !== 'tool-failure') {
    throw new EvolutionError('observation.kind is invalid', 'CORRUPT_STORE')
  }
  return Object.freeze({
    id: observationId(stringOf(raw.id, 'observation.id')),
    kind: 'tool-failure',
    sessionId: stringOf(raw.sessionId, 'observation.sessionId'),
    toolName: stringOf(raw.toolName, 'observation.toolName'),
    errorCode: stringOf(raw.errorCode, 'observation.errorCode'),
    summary: stringOf(raw.summary, 'observation.summary'),
    observedAt: isoOf(raw.observedAt, 'observation.observedAt'),
  })
}

function proposalOf(value: unknown): EvolutionProposal {
  const raw = objectOf(value, 'proposal')
  if (raw.kind !== 'strategy-guidance' || raw.status !== 'evaluating') {
    throw new EvolutionError('created proposal kind or status is invalid', 'CORRUPT_STORE')
  }
  return Object.freeze({
    id: proposalId(stringOf(raw.id, 'proposal.id')),
    observationId: observationId(stringOf(raw.observationId, 'proposal.observationId')),
    kind: 'strategy-guidance',
    title: stringOf(raw.title, 'proposal.title'),
    guidance: stringOf(raw.guidance, 'proposal.guidance'),
    status: 'evaluating',
    createdAt: isoOf(raw.createdAt, 'proposal.createdAt'),
    updatedAt: isoOf(raw.updatedAt, 'proposal.updatedAt'),
  })
}

function eventOf(value: unknown, expectedSeq: number): EvolutionAuditEvent {
  const raw = objectOf(value, `audit line ${String(expectedSeq + 1)}`)
  if (raw.schemaVersion !== 1 || raw.seq !== expectedSeq) {
    throw new EvolutionError(`audit sequence ${String(expectedSeq)} is invalid`, 'CORRUPT_STORE')
  }
  const envelope = { schemaVersion: 1 as const, seq: expectedSeq, at: isoOf(raw.at, 'event.at') }
  switch (raw.kind) {
    case 'observation-recorded':
      return { ...envelope, kind: raw.kind, observation: observationOf(raw.observation) }
    case 'proposal-created':
      return { ...envelope, kind: raw.kind, proposal: proposalOf(raw.proposal) }
    case 'verification-recorded':
      return {
        ...envelope,
        kind: raw.kind,
        proposalId: proposalId(stringOf(raw.proposalId, 'event.proposalId')),
        outcome: verificationOf(raw.outcome),
      }
    case 'proposal-accepted':
    case 'proposal-promoted':
      return {
        ...envelope,
        kind: raw.kind,
        proposalId: proposalId(stringOf(raw.proposalId, 'event.proposalId')),
      }
    case 'proposal-rejected':
      return {
        ...envelope,
        kind: raw.kind,
        proposalId: proposalId(stringOf(raw.proposalId, 'event.proposalId')),
        reason: stringOf(raw.reason, 'event.reason'),
      }
    default:
      throw new EvolutionError(`unknown audit event ${String(raw.kind)}`, 'CORRUPT_STORE')
  }
}

function replaceProposal(
  state: MutableState,
  id: ProposalId,
  allowed: readonly EvolutionProposal['status'][],
  update: (current: EvolutionProposal) => EvolutionProposal,
): void {
  const current = state.proposals.get(id)
  if (current === undefined)
    throw new EvolutionError(`proposal ${id} does not exist`, 'CORRUPT_STORE')
  if (!allowed.includes(current.status)) {
    throw new EvolutionError(
      `proposal ${id} cannot transition from ${current.status}`,
      'CORRUPT_STORE',
    )
  }
  state.proposals.set(id, Object.freeze(update(current)))
}

function applyEvent(state: MutableState, event: EvolutionAuditEvent): void {
  switch (event.kind) {
    case 'observation-recorded':
      if (state.observations.has(event.observation.id)) {
        throw new EvolutionError(`duplicate observation ${event.observation.id}`, 'CORRUPT_STORE')
      }
      state.observations.set(event.observation.id, event.observation)
      break
    case 'proposal-created':
      if (!state.observations.has(event.proposal.observationId)) {
        throw new EvolutionError('proposal references a missing observation', 'CORRUPT_STORE')
      }
      if (state.proposals.has(event.proposal.id)) {
        throw new EvolutionError(`duplicate proposal ${event.proposal.id}`, 'CORRUPT_STORE')
      }
      state.proposals.set(event.proposal.id, event.proposal)
      break
    case 'verification-recorded':
      replaceProposal(state, event.proposalId, ['evaluating'], (proposal) => ({
        ...proposal,
        status: event.outcome.decision === 'passed' ? 'pending' : 'rejected',
        verification: event.outcome,
        ...(event.outcome.decision === 'failed' ? { rejectionReason: event.outcome.evidence } : {}),
        updatedAt: event.at,
      }))
      break
    case 'proposal-accepted':
      replaceProposal(state, event.proposalId, ['pending'], (proposal) => ({
        ...proposal,
        status: 'accepted',
        updatedAt: event.at,
      }))
      break
    case 'proposal-rejected':
      replaceProposal(state, event.proposalId, ['pending', 'accepted'], (proposal) => ({
        ...proposal,
        status: 'rejected',
        rejectionReason: event.reason,
        updatedAt: event.at,
      }))
      break
    case 'proposal-promoted':
      replaceProposal(state, event.proposalId, ['accepted'], (proposal) => ({
        ...proposal,
        status: 'promoted',
        updatedAt: event.at,
      }))
      break
  }
  state.lastSeq = event.seq
}

function parseLog(text: string): {
  readonly events: EvolutionAuditEvent[]
  readonly state: MutableState
} {
  const events: EvolutionAuditEvent[] = []
  const state = emptyState()
  const lines = text.length === 0 ? [] : text.trimEnd().split('\n')
  for (const [seq, line] of lines.entries()) {
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      throw new EvolutionError(`audit line ${String(seq + 1)} is not JSON`, 'CORRUPT_STORE')
    }
    const event = eventOf(value, seq)
    events.push(event)
    applyEvent(state, event)
  }
  return { events, state }
}

async function readLog(filename: string): Promise<string> {
  try {
    return await readFile(filename, 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

/** Versioned append-only audit store committed by atomic whole-file replacement. */
export class EvolutionStore {
  private state: MutableState
  private tail: Promise<void> = Promise.resolve()

  private constructor(
    private readonly filename: string,
    state: MutableState,
  ) {
    this.state = state
  }

  /** Open and validate the complete audit stream before serving reads. */
  static async open(dataDir: string): Promise<EvolutionStore> {
    await mkdir(dataDir, { recursive: true, mode: 0o700 })
    const filename = join(dataDir, STORE_FILE)
    const { state } = parseLog(await readLog(filename))
    return new EvolutionStore(filename, state)
  }

  /** @returns a detached read projection. */
  snapshot(): EvolutionState {
    return {
      observations: new Map(this.state.observations),
      proposals: new Map(this.state.proposals),
      lastSeq: this.state.lastSeq,
    }
  }

  /** Atomically persist observation, proposal, and verification facts. */
  recordPipeline(
    observation: EvolutionObservation,
    proposal: EvolutionProposal,
    outcome: VerificationOutcome,
  ): Promise<EvolutionProposal> {
    return this.transact((state) => {
      if (state.observations.has(observation.id) || state.proposals.has(proposal.id)) {
        throw new EvolutionError('generated evolution id already exists', 'INVALID_TRANSITION')
      }
      return [
        { kind: 'observation-recorded', observation },
        { kind: 'proposal-created', proposal },
        { kind: 'verification-recorded', proposalId: proposal.id, outcome },
      ]
    }).then((state) => this.requireProposal(state, proposal.id))
  }

  /** Persist an idempotent human acceptance. */
  accept(id: ProposalId): Promise<EvolutionProposal> {
    return this.transition(id, 'accepted', ['pending'], {
      kind: 'proposal-accepted',
      proposalId: id,
    })
  }

  /** Persist an idempotent human rejection. */
  reject(id: ProposalId, reason: string): Promise<EvolutionProposal> {
    return this.transition(id, 'rejected', ['pending', 'accepted'], {
      kind: 'proposal-rejected',
      proposalId: id,
      reason,
    })
  }

  /** Persist an idempotent promotion after acceptance. */
  promote(id: ProposalId): Promise<EvolutionProposal> {
    return this.transition(id, 'promoted', ['accepted'], {
      kind: 'proposal-promoted',
      proposalId: id,
    })
  }

  /** @returns fulfillment after the in-process mutation queue settles. */
  whenIdle(): Promise<void> {
    return this.tail
  }

  private transition(
    id: ProposalId,
    target: EvolutionProposal['status'],
    allowed: readonly EvolutionProposal['status'][],
    body: EventBody,
  ): Promise<EvolutionProposal> {
    return this.transact((state) => {
      const current = state.proposals.get(id)
      if (current === undefined)
        throw new EvolutionError(`proposal ${id} was not found`, 'NOT_FOUND')
      if (current.status === target) return []
      if (!allowed.includes(current.status)) {
        throw new EvolutionError(
          `proposal ${id} cannot transition from ${current.status} to ${target}`,
          'INVALID_TRANSITION',
        )
      }
      return [body]
    }).then((state) => this.requireProposal(state, id))
  }

  private requireProposal(state: MutableState, id: ProposalId): EvolutionProposal {
    const proposal = state.proposals.get(id)
    if (proposal === undefined)
      throw new EvolutionError(`proposal ${id} was not found`, 'NOT_FOUND')
    return proposal
  }

  private transact(build: (state: MutableState) => readonly EventBody[]): Promise<MutableState> {
    const operation = this.tail.then(async () => {
      let committed = emptyState()
      await withFileLock(this.filename, async () => {
        const text = await readLog(this.filename)
        const parsed = parseLog(text)
        committed = parsed.state
        const bodies = build(committed)
        if (bodies.length === 0) return
        const events = [...parsed.events]
        for (const body of bodies) {
          const event = {
            schemaVersion: 1,
            seq: events.length,
            at: new Date().toISOString(),
            ...body,
          } as EvolutionAuditEvent
          applyEvent(committed, event)
          events.push(event)
        }
        const nextText = `${events.map((event) => JSON.stringify(event)).join('\n')}\n`
        await writeFileAtomic(this.filename, nextText, { mode: 0o600, dirMode: 0o700 })
      })
      this.state = committed
      return committed
    })
    this.tail = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }
}
