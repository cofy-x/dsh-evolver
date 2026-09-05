/** store responsibilities for the audited evolution store. @module dsh-evolver/store */

import {
  EvolutionError,
  type EvaluationPolicy,
  type EvolutionAuditEvent,
  type EvolutionObservation,
  type EvolutionProposal,
  type EvolutionState,
  type FailurePattern,
  type GenerationReservationId,
  type ProposalAdmissionPolicy,
  type ProposalGenerationReservation,
  type ProposalId,
  type ToolOutcome,
  type VerificationOutcome,
} from './domain.ts'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  emptyState,
  outcomeKey,
  reservationById,
  type MutableState,
  type EventBody,
} from './audit-state.ts'
import { eventOf } from './audit-codec.ts'
import { applyEvent, parseLog } from './projection.ts'
import { createPromotionEvaluation, shouldSampleOutcome } from './evaluation-projection.ts'
import { planFailureAdmission } from './admission.ts'
import type { FailurePatternSignature } from './pattern.ts'
const STORE_FILE = 'audit-v1.jsonl'

/** Result of the lock-protected occurrence and proposal-admission phase. */
export interface FailureAdmissionResult {
  readonly pattern: FailurePattern
  readonly reservation?: ProposalGenerationReservation
  readonly priorTerminalStatus?: 'rejected' | 'superseded'
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
      patterns: new Map(this.state.patterns),
      reservations: new Map(this.state.reservations),
      outcomes: new Map(this.state.outcomes),
      evaluations: new Map(this.state.evaluations),
      lastSeq: this.state.lastSeq,
    }
  }

  /** Persist a failure occurrence and reserve at most one eligible proposal generation. */
  admitFailure(
    outcome: ToolOutcome | undefined,
    observation: EvolutionObservation,
    signature: FailurePatternSignature,
    candidate: {
      readonly reservationId: GenerationReservationId
      readonly proposalId: ProposalId
    },
    policy: ProposalAdmissionPolicy,
  ): Promise<FailureAdmissionResult | undefined> {
    let admittedReservationId: GenerationReservationId | undefined
    let priorTerminalStatus: 'rejected' | 'superseded' | undefined
    return this.transact((state) => {
      const plan = planFailureAdmission(
        state,
        outcome,
        observation,
        signature,
        candidate,
        policy,
        new Date().toISOString(),
      )
      admittedReservationId = plan.admittedReservationId
      priorTerminalStatus = plan.priorTerminalStatus
      return plan.bodies
    }).then((state) => {
      const pattern = state.patterns.get(signature.id)
      if (pattern === undefined) return undefined
      const reservation = state.reservations.get(signature.id)
      return Object.freeze({
        pattern,
        ...(admittedReservationId !== undefined && reservation?.id === admittedReservationId
          ? { reservation }
          : {}),
        ...(priorTerminalStatus ? { priorTerminalStatus } : {}),
      })
    })
  }

  /** Complete the exact still-owned reservation with proposal and verification facts. */
  finalizeReservation(
    reservationId: GenerationReservationId,
    proposal: EvolutionProposal,
    verification: VerificationOutcome,
  ): Promise<EvolutionProposal> {
    return this.transact((state) => {
      const reservation = reservationById(state, reservationId)
      if (reservation?.proposalId !== proposal.id) {
        throw new EvolutionError('proposal generation reservation was lost', 'INVALID_TRANSITION')
      }
      return [
        { kind: 'proposal-created', proposal },
        { kind: 'verification-recorded', proposalId: proposal.id, outcome: verification },
      ]
    }).then((state) => this.requireProposal(state, proposal.id))
  }

  /** Release a reservation after provider failure; a later occurrence may retry generation. */
  abandonReservation(
    reservationId: GenerationReservationId,
    reason: 'provider-failed',
  ): Promise<void> {
    return this.transact((state) =>
      reservationById(state, reservationId)
        ? [{ kind: 'proposal-generation-abandoned', reservationId, reason }]
        : [],
    ).then(() => undefined)
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

  /** Atomically persist one outcome and, for failures, its proposal pipeline. */
  recordToolResultPipeline(
    outcome: ToolOutcome,
    policy: EvaluationPolicy,
    pipeline?: {
      readonly observation: EvolutionObservation
      readonly proposal: EvolutionProposal
      readonly verification: VerificationOutcome
    },
  ): Promise<EvolutionProposal | undefined> {
    let createdProposal = false
    return this.transact((state) => {
      if (state.outcomeKeys.has(outcomeKey(outcome))) return []
      if (pipeline === undefined) {
        return shouldSampleOutcome(state, outcome, policy)
          ? [{ kind: 'tool-outcome-recorded', outcome }]
          : []
      }
      if (
        state.observations.has(pipeline.observation.id) ||
        state.proposals.has(pipeline.proposal.id)
      ) {
        throw new EvolutionError('generated evolution id already exists', 'INVALID_TRANSITION')
      }
      createdProposal = true
      return [
        { kind: 'tool-outcome-recorded', outcome },
        { kind: 'observation-recorded', observation: pipeline.observation },
        { kind: 'proposal-created', proposal: pipeline.proposal },
        {
          kind: 'verification-recorded',
          proposalId: pipeline.proposal.id,
          outcome: pipeline.verification,
        },
      ]
    }).then((state) =>
      pipeline === undefined || !createdProposal
        ? undefined
        : this.requireProposal(state, pipeline.proposal.id),
    )
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
  promote(id: ProposalId, policy: EvaluationPolicy): Promise<EvolutionProposal> {
    return this.transact((state) => {
      const current = state.proposals.get(id)
      if (current === undefined)
        throw new EvolutionError(`proposal ${id} was not found`, 'NOT_FOUND')
      if (current.status === 'promoted') return []
      if (current.status !== 'accepted') {
        throw new EvolutionError(
          `proposal ${id} cannot transition from ${current.status} to promoted`,
          'INVALID_TRANSITION',
        )
      }
      if (
        current.patternId !== undefined &&
        [...state.proposals.values()].some(
          (proposal) =>
            proposal.id !== current.id &&
            proposal.patternId === current.patternId &&
            proposal.status === 'promoted',
        )
      ) {
        throw new EvolutionError(
          `failure pattern ${current.patternId} already has a promoted generation`,
          'INVALID_TRANSITION',
        )
      }
      const at = new Date().toISOString()
      const evaluation = createPromotionEvaluation(state, id, policy, at)
      return [{ kind: 'proposal-promoted', proposalId: id, evaluation }]
    }).then((state) => this.requireProposal(state, id))
  }

  /** Persist an idempotent human rollback as a superseding audit fact. */
  supersede(id: ProposalId, reason: string): Promise<EvolutionProposal> {
    return this.transition(id, 'superseded', ['promoted'], {
      kind: 'proposal-superseded',
      proposalId: id,
      reason,
    })
  }

  /** Persist newly exposed strategy/session pairs without duplicating prior exposure. */
  recordExposure(sessionId: string, proposalIds: readonly ProposalId[]): Promise<void> {
    return this.transact((state) => {
      const existing = state.exposures.get(sessionId)
      const missing = proposalIds.filter((id) => !existing?.has(id))
      return missing.length === 0
        ? []
        : [{ kind: 'strategies-exposed', sessionId, proposalIds: missing }]
    }).then(() => undefined)
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
          const validated = eventOf(event, events.length)
          applyEvent(committed, validated)
          events.push(validated)
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
