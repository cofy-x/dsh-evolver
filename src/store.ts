/** Atomic JSONL audit persistence and replay. @module dsh-evolver/store */

import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  EvolutionError,
  failurePatternId,
  generationReservationId,
  observationId,
  proposalId,
  toolOutcomeId,
  type EvaluationPolicy,
  type EvolutionAuditEvent,
  type EvolutionEvaluation,
  type EvolutionObservation,
  type EvolutionProposal,
  type EvolutionState,
  type FailurePattern,
  type FailurePatternId,
  type FailurePatternKeyVersion,
  type GenerationReservationId,
  type ProposalAdmissionPolicy,
  type ProposalGenerationReservation,
  type ProposalId,
  type ToolOutcome,
  type ToolOutcomeId,
  type VerificationOutcome,
} from './domain.ts'
import { evaluateEffectiveness } from './evaluation.ts'
import { deriveFailurePatternSignature, type FailurePatternSignature } from './pattern.ts'

const STORE_FILE = 'audit-v1.jsonl'

/** Result of the lock-protected occurrence and proposal-admission phase. */
export interface FailureAdmissionResult {
  readonly pattern: FailurePattern
  readonly reservation?: ProposalGenerationReservation
  readonly priorTerminalStatus?: 'rejected' | 'superseded'
}

type EventBody = EvolutionAuditEvent extends infer Event
  ? Event extends EvolutionAuditEvent
    ? Omit<Event, 'schemaVersion' | 'seq' | 'at'>
    : never
  : never

interface MutableState {
  readonly observations: Map<ReturnType<typeof observationId>, EvolutionObservation>
  readonly proposals: Map<ProposalId, EvolutionProposal>
  readonly patterns: Map<FailurePatternId, FailurePattern>
  readonly patternObservationIds: Set<ReturnType<typeof observationId>>
  readonly observationSequences: Map<ReturnType<typeof observationId>, number>
  readonly outcomeSequences: Map<ToolOutcomeId, number>
  readonly reservations: Map<FailurePatternId, ProposalGenerationReservation>
  readonly outcomes: Map<ToolOutcomeId, ToolOutcome>
  readonly outcomeKeys: Set<string>
  readonly exposures: Map<string, Set<ProposalId>>
  readonly evaluations: Map<ProposalId, EvolutionEvaluation>
  lastSeq: number
}

function emptyState(): MutableState {
  return {
    observations: new Map(),
    proposals: new Map(),
    patterns: new Map(),
    patternObservationIds: new Set(),
    observationSequences: new Map(),
    outcomeSequences: new Map(),
    reservations: new Map(),
    outcomes: new Map(),
    outcomeKeys: new Set(),
    exposures: new Map(),
    evaluations: new Map(),
    lastSeq: -1,
  }
}

function positiveIntegerOf(value: unknown, context: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new EvolutionError(`${context} must be a positive integer`, 'CORRUPT_STORE')
  }
  return value as number
}

function countOf(value: unknown, context: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new EvolutionError(`${context} must be a non-negative integer`, 'CORRUPT_STORE')
  }
  return value as number
}

function thresholdOf(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1) {
    throw new EvolutionError(`${context} must be greater than 0 and at most 1`, 'CORRUPT_STORE')
  }
  return value
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

interface FailurePatternSeed {
  readonly id: FailurePatternId
  readonly keyVersion: FailurePatternKeyVersion
  readonly toolName: string
  readonly errorCode: string
  readonly canonicalSummary: string
  readonly firstSeenAt: string
}

function patternSeedOf(value: unknown): FailurePatternSeed {
  const raw = objectOf(value, 'failure pattern')
  if (raw.keyVersion !== 'failure-pattern-v1') {
    throw new EvolutionError('failure pattern key version is invalid', 'CORRUPT_STORE')
  }
  const seed = Object.freeze({
    id: failurePatternId(stringOf(raw.id, 'failure pattern.id')),
    keyVersion: raw.keyVersion,
    toolName: stringOf(raw.toolName, 'failure pattern.toolName'),
    errorCode: stringOf(raw.errorCode, 'failure pattern.errorCode'),
    canonicalSummary: stringOf(raw.canonicalSummary, 'failure pattern.canonicalSummary'),
    firstSeenAt: isoOf(raw.firstSeenAt, 'failure pattern.firstSeenAt'),
  })
  const expected = deriveFailurePatternSignature(
    seed.toolName,
    seed.errorCode,
    seed.canonicalSummary,
  )
  if (expected.id !== seed.id || expected.canonicalSummary !== seed.canonicalSummary) {
    throw new EvolutionError('failure pattern signature is inconsistent', 'CORRUPT_STORE')
  }
  return seed
}

function reservationOf(value: unknown): ProposalGenerationReservation {
  const raw = objectOf(value, 'proposal generation reservation')
  const reservation = Object.freeze({
    id: generationReservationId(stringOf(raw.id, 'reservation.id')),
    patternId: failurePatternId(stringOf(raw.patternId, 'reservation.patternId')),
    proposalId: proposalId(stringOf(raw.proposalId, 'reservation.proposalId')),
    observationId: observationId(stringOf(raw.observationId, 'reservation.observationId')),
    generation: positiveIntegerOf(raw.generation, 'reservation.generation'),
    occurrence: positiveIntegerOf(raw.occurrence, 'reservation.occurrence'),
    reservedAt: isoOf(raw.reservedAt, 'reservation.reservedAt'),
    expiresAt: isoOf(raw.expiresAt, 'reservation.expiresAt'),
  })
  if (reservation.expiresAt <= reservation.reservedAt) {
    throw new EvolutionError('reservation expiry must follow reservation start', 'CORRUPT_STORE')
  }
  return reservation
}

function toolOutcomeOf(value: unknown): ToolOutcome {
  const raw = objectOf(value, 'tool outcome')
  if (raw.result !== 'succeeded' && raw.result !== 'failed') {
    throw new EvolutionError('tool outcome result is invalid', 'CORRUPT_STORE')
  }
  return Object.freeze({
    id: toolOutcomeId(stringOf(raw.id, 'tool outcome.id')),
    sessionId: stringOf(raw.sessionId, 'tool outcome.sessionId'),
    callId: stringOf(raw.callId, 'tool outcome.callId'),
    toolName: stringOf(raw.toolName, 'tool outcome.toolName'),
    result: raw.result,
    observedAt: isoOf(raw.observedAt, 'tool outcome.observedAt'),
  })
}

function evaluationOf(value: unknown): EvolutionEvaluation {
  const raw = objectOf(value, 'evaluation')
  const baseline = objectOf(raw.baseline, 'evaluation.baseline')
  const treatment = objectOf(raw.treatment, 'evaluation.treatment')
  const seed = {
    proposalId: proposalId(stringOf(raw.proposalId, 'evaluation.proposalId')),
    targetTool: stringOf(raw.targetTool, 'evaluation.targetTool'),
    windowSize: positiveIntegerOf(raw.windowSize, 'evaluation.windowSize'),
    minimumSamples: positiveIntegerOf(raw.minimumSamples, 'evaluation.minimumSamples'),
    regressionThreshold: thresholdOf(raw.regressionThreshold, 'evaluation.regressionThreshold'),
    baseline: {
      total: countOf(baseline.total, 'evaluation.baseline.total'),
      failed: countOf(baseline.failed, 'evaluation.baseline.failed'),
    },
    treatment: {
      total: countOf(treatment.total, 'evaluation.treatment.total'),
      failed: countOf(treatment.failed, 'evaluation.treatment.failed'),
    },
    updatedAt: isoOf(raw.updatedAt, 'evaluation.updatedAt'),
  }
  if (
    seed.minimumSamples > seed.windowSize ||
    seed.baseline.total > seed.windowSize ||
    seed.baseline.failed > seed.baseline.total ||
    seed.treatment.total > seed.windowSize ||
    seed.treatment.failed > seed.treatment.total
  ) {
    throw new EvolutionError('evaluation counts or bounds are invalid', 'CORRUPT_STORE')
  }
  const calculated = evaluateEffectiveness(seed)
  if (raw.verdict !== calculated.verdict || raw.failureRateDelta !== calculated.failureRateDelta) {
    throw new EvolutionError('evaluation projection is inconsistent', 'CORRUPT_STORE')
  }
  return Object.freeze(calculated)
}

function proposalOf(value: unknown): EvolutionProposal {
  const raw = objectOf(value, 'proposal')
  if (raw.kind !== 'strategy-guidance' || raw.status !== 'evaluating') {
    throw new EvolutionError('created proposal kind or status is invalid', 'CORRUPT_STORE')
  }
  const patternFields =
    raw.patternId === undefined &&
    raw.patternOccurrence === undefined &&
    raw.generation === undefined
      ? {}
      : {
          patternId: failurePatternId(stringOf(raw.patternId, 'proposal.patternId')),
          patternOccurrence: positiveIntegerOf(raw.patternOccurrence, 'proposal.patternOccurrence'),
          generation: positiveIntegerOf(raw.generation, 'proposal.generation'),
        }
  return Object.freeze({
    id: proposalId(stringOf(raw.id, 'proposal.id')),
    observationId: observationId(stringOf(raw.observationId, 'proposal.observationId')),
    ...patternFields,
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
    case 'failure-pattern-created':
      return { ...envelope, kind: raw.kind, pattern: patternSeedOf(raw.pattern) }
    case 'failure-pattern-occurred':
      return {
        ...envelope,
        kind: raw.kind,
        patternId: failurePatternId(stringOf(raw.patternId, 'event.patternId')),
        observationId: observationId(stringOf(raw.observationId, 'event.observationId')),
        occurrence: positiveIntegerOf(raw.occurrence, 'event.occurrence'),
      }
    case 'proposal-generation-reserved':
      return { ...envelope, kind: raw.kind, reservation: reservationOf(raw.reservation) }
    case 'proposal-generation-abandoned': {
      if (raw.reason !== 'provider-failed' && raw.reason !== 'expired') {
        throw new EvolutionError('reservation abandonment reason is invalid', 'CORRUPT_STORE')
      }
      return {
        ...envelope,
        kind: raw.kind,
        reservationId: generationReservationId(stringOf(raw.reservationId, 'event.reservationId')),
        reason: raw.reason,
      }
    }
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
      return {
        ...envelope,
        kind: raw.kind,
        proposalId: proposalId(stringOf(raw.proposalId, 'event.proposalId')),
      }
    case 'proposal-promoted':
      return {
        ...envelope,
        kind: raw.kind,
        proposalId: proposalId(stringOf(raw.proposalId, 'event.proposalId')),
        ...(raw.evaluation === undefined ? {} : { evaluation: evaluationOf(raw.evaluation) }),
      }
    case 'proposal-rejected':
    case 'proposal-superseded':
      return {
        ...envelope,
        kind: raw.kind,
        proposalId: proposalId(stringOf(raw.proposalId, 'event.proposalId')),
        reason: stringOf(raw.reason, 'event.reason'),
      }
    case 'tool-outcome-recorded':
      return { ...envelope, kind: raw.kind, outcome: toolOutcomeOf(raw.outcome) }
    case 'strategies-exposed': {
      if (!Array.isArray(raw.proposalIds) || raw.proposalIds.length === 0) {
        throw new EvolutionError('event.proposalIds must be a non-empty array', 'CORRUPT_STORE')
      }
      return {
        ...envelope,
        kind: raw.kind,
        sessionId: stringOf(raw.sessionId, 'event.sessionId'),
        proposalIds: raw.proposalIds.map((id) => proposalId(stringOf(id, 'event.proposalId'))),
      }
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

function outcomeKey(outcome: Pick<ToolOutcome, 'sessionId' | 'callId'>): string {
  return `${outcome.sessionId}\u0000${outcome.callId}`
}

function updateEvaluations(state: MutableState, outcome: ToolOutcome, at: string): void {
  const exposed = state.exposures.get(outcome.sessionId)
  if (exposed === undefined) return
  for (const id of exposed) {
    const evaluation = state.evaluations.get(id)
    const proposal = state.proposals.get(id)
    if (
      evaluation === undefined ||
      proposal?.status !== 'promoted' ||
      evaluation.targetTool !== outcome.toolName ||
      evaluation.treatment.total >= evaluation.windowSize
    ) {
      continue
    }
    state.evaluations.set(
      id,
      Object.freeze(
        evaluateEffectiveness({
          ...evaluation,
          treatment: {
            total: evaluation.treatment.total + 1,
            failed: evaluation.treatment.failed + (outcome.result === 'failed' ? 1 : 0),
          },
          updatedAt: at,
        }),
      ),
    )
  }
}

function createPromotionEvaluation(
  state: MutableState,
  id: ProposalId,
  policy: EvaluationPolicy,
  at: string,
): EvolutionEvaluation {
  const proposal = state.proposals.get(id)
  if (proposal === undefined) {
    throw new EvolutionError('proposal is missing', 'CORRUPT_STORE')
  }
  const observation = state.observations.get(proposal.observationId)
  if (observation === undefined) {
    throw new EvolutionError('proposal observation is missing', 'CORRUPT_STORE')
  }
  const eligibleOutcomes = [...state.outcomes.values()].filter(
    (outcome) =>
      outcome.toolName === observation.toolName && isBaselineOutcome(state, proposal, outcome),
  )
  // Success sampling stops once the window fills; later failures must not evict those successes.
  const baselineOutcomes =
    proposal.patternId === undefined
      ? eligibleOutcomes.slice(-policy.windowSize)
      : eligibleOutcomes.slice(0, policy.windowSize)
  return Object.freeze(
    evaluateEffectiveness({
      proposalId: id,
      targetTool: observation.toolName,
      ...policy,
      baseline: {
        total: baselineOutcomes.length,
        failed: baselineOutcomes.filter((outcome) => outcome.result === 'failed').length,
      },
      treatment: { total: 0, failed: 0 },
      updatedAt: at,
    }),
  )
}

/** New pattern generations use audit order, including their triggering outcome immediately before the observation. */
function isBaselineOutcome(
  state: MutableState,
  proposal: EvolutionProposal,
  outcome: ToolOutcome,
): boolean {
  if (proposal.patternId === undefined) return outcome.observedAt >= proposal.createdAt
  const observationSeq = state.observationSequences.get(proposal.observationId)
  const outcomeSeq = state.outcomeSequences.get(outcome.id)
  if (observationSeq === undefined || outcomeSeq === undefined) return false
  if (outcomeSeq >= observationSeq) return true
  const observation = state.observations.get(proposal.observationId)
  return (
    outcomeSeq === observationSeq - 1 &&
    outcome.result === 'failed' &&
    outcome.sessionId === observation?.sessionId &&
    outcome.observedAt === observation.observedAt
  )
}

function shouldSampleOutcome(
  state: MutableState,
  outcome: ToolOutcome,
  policy: EvaluationPolicy,
): boolean {
  const exposed = state.exposures.get(outcome.sessionId)
  if (
    exposed &&
    [...exposed].some((id) => {
      const evaluation = state.evaluations.get(id)
      return (
        state.proposals.get(id)?.status === 'promoted' &&
        evaluation?.targetTool === outcome.toolName &&
        evaluation.treatment.total < evaluation.windowSize
      )
    })
  ) {
    return true
  }
  return [...state.proposals.values()].some((proposal) => {
    if (proposal.status !== 'pending' && proposal.status !== 'accepted') return false
    const observation = state.observations.get(proposal.observationId)
    if (observation?.toolName !== outcome.toolName) return false
    const collected = [...state.outcomes.values()].filter(
      (candidate) =>
        candidate.toolName === outcome.toolName && isBaselineOutcome(state, proposal, candidate),
    ).length
    return collected < policy.windowSize
  })
}

function reservationById(
  state: MutableState,
  id: GenerationReservationId,
): ProposalGenerationReservation | undefined {
  return [...state.reservations.values()].find((reservation) => reservation.id === id)
}

function clearPatternActiveProposal(state: MutableState, proposal: EvolutionProposal): void {
  if (proposal.patternId === undefined) return
  const pattern = state.patterns.get(proposal.patternId)
  if (pattern?.activeProposalId !== proposal.id) {
    throw new EvolutionError('pattern active proposal projection is inconsistent', 'CORRUPT_STORE')
  }
  const inactive = { ...pattern }
  Reflect.deleteProperty(inactive, 'activeProposalId')
  state.patterns.set(pattern.id, Object.freeze(inactive))
}

function applyEvent(state: MutableState, event: EvolutionAuditEvent): void {
  switch (event.kind) {
    case 'observation-recorded':
      if (state.observations.has(event.observation.id)) {
        throw new EvolutionError(`duplicate observation ${event.observation.id}`, 'CORRUPT_STORE')
      }
      state.observations.set(event.observation.id, event.observation)
      state.observationSequences.set(event.observation.id, event.seq)
      break
    case 'failure-pattern-created': {
      if (state.patterns.has(event.pattern.id)) {
        throw new EvolutionError(`duplicate failure pattern ${event.pattern.id}`, 'CORRUPT_STORE')
      }
      state.patterns.set(
        event.pattern.id,
        Object.freeze({
          ...event.pattern,
          occurrenceCount: 0,
          lastSeenAt: event.pattern.firstSeenAt,
          representativeObservationIds: [],
          latestGeneration: 0,
        }),
      )
      break
    }
    case 'failure-pattern-occurred': {
      const pattern = state.patterns.get(event.patternId)
      const observation = state.observations.get(event.observationId)
      if (pattern === undefined || observation === undefined) {
        throw new EvolutionError('pattern occurrence references missing state', 'CORRUPT_STORE')
      }
      const signature = deriveFailurePatternSignature(
        observation.toolName,
        observation.errorCode,
        observation.summary,
      )
      if (
        signature.id !== pattern.id ||
        state.patternObservationIds.has(observation.id) ||
        event.occurrence !== pattern.occurrenceCount + 1 ||
        (pattern.occurrenceCount === 0 && pattern.firstSeenAt !== observation.observedAt)
      ) {
        throw new EvolutionError('pattern occurrence is inconsistent', 'CORRUPT_STORE')
      }
      state.patterns.set(
        pattern.id,
        Object.freeze({
          ...pattern,
          occurrenceCount: event.occurrence,
          firstSeenAt:
            observation.observedAt < pattern.firstSeenAt
              ? observation.observedAt
              : pattern.firstSeenAt,
          lastSeenAt:
            observation.observedAt > pattern.lastSeenAt
              ? observation.observedAt
              : pattern.lastSeenAt,
          representativeObservationIds: Object.freeze(
            [...pattern.representativeObservationIds, observation.id].slice(-8),
          ),
        }),
      )
      state.patternObservationIds.add(observation.id)
      break
    }
    case 'proposal-generation-reserved': {
      const reservation = event.reservation
      const pattern = state.patterns.get(reservation.patternId)
      if (
        pattern === undefined ||
        pattern.activeProposalId !== undefined ||
        state.reservations.has(pattern.id) ||
        state.proposals.has(reservation.proposalId) ||
        !pattern.representativeObservationIds.includes(reservation.observationId) ||
        reservation.generation !== pattern.latestGeneration + 1 ||
        reservation.occurrence !== pattern.occurrenceCount
      ) {
        throw new EvolutionError('proposal reservation is inconsistent', 'CORRUPT_STORE')
      }
      state.reservations.set(pattern.id, reservation)
      break
    }
    case 'proposal-generation-abandoned': {
      const reservation = reservationById(state, event.reservationId)
      if (reservation === undefined) {
        throw new EvolutionError('abandonment references a missing reservation', 'CORRUPT_STORE')
      }
      state.reservations.delete(reservation.patternId)
      break
    }
    case 'proposal-created': {
      if (!state.observations.has(event.proposal.observationId)) {
        throw new EvolutionError('proposal references a missing observation', 'CORRUPT_STORE')
      }
      if (state.proposals.has(event.proposal.id)) {
        throw new EvolutionError(`duplicate proposal ${event.proposal.id}`, 'CORRUPT_STORE')
      }
      if (event.proposal.patternId !== undefined) {
        const pattern = state.patterns.get(event.proposal.patternId)
        const reservation = state.reservations.get(event.proposal.patternId)
        if (
          pattern === undefined ||
          reservation?.proposalId !== event.proposal.id ||
          reservation.observationId !== event.proposal.observationId ||
          reservation.generation !== event.proposal.generation ||
          reservation.occurrence !== event.proposal.patternOccurrence ||
          pattern.activeProposalId !== undefined
        ) {
          throw new EvolutionError('pattern proposal admission is inconsistent', 'CORRUPT_STORE')
        }
        state.patterns.set(
          pattern.id,
          Object.freeze({
            ...pattern,
            latestProposalId: event.proposal.id,
            latestProposalOccurrence: event.proposal.patternOccurrence,
            latestGeneration: event.proposal.generation,
            activeProposalId: event.proposal.id,
          }),
        )
        state.reservations.delete(pattern.id)
      }
      state.proposals.set(event.proposal.id, event.proposal)
      break
    }
    case 'verification-recorded':
      {
        const before = state.proposals.get(event.proposalId)
        if (before === undefined) {
          throw new EvolutionError('verification references a missing proposal', 'CORRUPT_STORE')
        }
        if (event.outcome.decision === 'failed') clearPatternActiveProposal(state, before)
      }
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
      {
        const before = state.proposals.get(event.proposalId)
        if (before === undefined) {
          throw new EvolutionError('rejection references a missing proposal', 'CORRUPT_STORE')
        }
        clearPatternActiveProposal(state, before)
      }
      replaceProposal(state, event.proposalId, ['pending', 'accepted'], (proposal) => ({
        ...proposal,
        status: 'rejected',
        rejectionReason: event.reason,
        updatedAt: event.at,
      }))
      break
    case 'proposal-promoted': {
      const current = state.proposals.get(event.proposalId)
      if (
        current?.patternId !== undefined &&
        [...state.proposals.values()].some(
          (proposal) =>
            proposal.id !== current.id &&
            proposal.patternId === current.patternId &&
            proposal.status === 'promoted',
        )
      ) {
        throw new EvolutionError(
          'failure pattern already has a promoted generation',
          'CORRUPT_STORE',
        )
      }
      replaceProposal(state, event.proposalId, ['accepted'], (proposal) => ({
        ...proposal,
        status: 'promoted',
        updatedAt: event.at,
      }))
      const evaluation =
        event.evaluation ??
        createPromotionEvaluation(
          state,
          event.proposalId,
          { windowSize: 20, minimumSamples: 5, regressionThreshold: 0.15 },
          event.at,
        )
      if (evaluation.proposalId !== event.proposalId) {
        throw new EvolutionError(
          'promotion evaluation references another proposal',
          'CORRUPT_STORE',
        )
      }
      state.evaluations.set(event.proposalId, evaluation)
      break
    }
    case 'proposal-superseded':
      {
        const before = state.proposals.get(event.proposalId)
        if (before === undefined) {
          throw new EvolutionError('supersede references a missing proposal', 'CORRUPT_STORE')
        }
        clearPatternActiveProposal(state, before)
      }
      replaceProposal(state, event.proposalId, ['promoted'], (proposal) => ({
        ...proposal,
        status: 'superseded',
        supersededReason: event.reason,
        updatedAt: event.at,
      }))
      break
    case 'tool-outcome-recorded': {
      const key = outcomeKey(event.outcome)
      if (state.outcomes.has(event.outcome.id) || state.outcomeKeys.has(key)) {
        throw new EvolutionError('duplicate tool outcome', 'CORRUPT_STORE')
      }
      state.outcomes.set(event.outcome.id, event.outcome)
      state.outcomeSequences.set(event.outcome.id, event.seq)
      state.outcomeKeys.add(key)
      updateEvaluations(state, event.outcome, event.at)
      break
    }
    case 'strategies-exposed': {
      const current = state.exposures.get(event.sessionId) ?? new Set<ProposalId>()
      for (const id of event.proposalIds) {
        const proposal = state.proposals.get(id)
        if (proposal?.status !== 'promoted') {
          throw new EvolutionError('exposure references a non-promoted proposal', 'CORRUPT_STORE')
        }
        current.add(id)
      }
      state.exposures.set(event.sessionId, current)
      break
    }
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
      if (outcome && state.outcomeKeys.has(outcomeKey(outcome))) return []
      const existing = state.patterns.get(signature.id)
      if (
        existing &&
        (existing.toolName !== observation.toolName ||
          existing.errorCode !== observation.errorCode ||
          existing.canonicalSummary !== signature.canonicalSummary)
      ) {
        throw new EvolutionError(
          'failure pattern hash collision or version mismatch',
          'CORRUPT_STORE',
        )
      }
      const occurrence = (existing?.occurrenceCount ?? 0) + 1
      const bodies: EventBody[] = [
        ...(outcome ? ([{ kind: 'tool-outcome-recorded', outcome }] as const) : []),
        { kind: 'observation-recorded', observation },
        ...(existing
          ? []
          : [
              {
                kind: 'failure-pattern-created' as const,
                pattern: {
                  id: signature.id,
                  keyVersion: signature.keyVersion,
                  toolName: observation.toolName,
                  errorCode: observation.errorCode,
                  canonicalSummary: signature.canonicalSummary,
                  firstSeenAt: observation.observedAt,
                },
              },
            ]),
        {
          kind: 'failure-pattern-occurred',
          patternId: signature.id,
          observationId: observation.id,
          occurrence,
        },
      ]
      const currentReservation = existing && state.reservations.get(existing.id)
      const reservedAt = new Date().toISOString()
      const nowMs = Date.parse(reservedAt)
      const reservationExpired =
        currentReservation !== undefined && Date.parse(currentReservation.expiresAt) <= nowMs
      if (reservationExpired) {
        bodies.push({
          kind: 'proposal-generation-abandoned',
          reservationId: currentReservation.id,
          reason: 'expired',
        })
      }
      const latestProposal =
        existing?.latestProposalId === undefined
          ? undefined
          : state.proposals.get(existing.latestProposalId)
      if (latestProposal?.status === 'rejected' || latestProposal?.status === 'superseded') {
        priorTerminalStatus = latestProposal.status
      }
      const occurrencesSinceProposal =
        existing?.latestProposalOccurrence === undefined
          ? Number.POSITIVE_INFINITY
          : occurrence - existing.latestProposalOccurrence
      const eligible =
        existing?.activeProposalId === undefined &&
        (currentReservation === undefined || reservationExpired) &&
        (latestProposal === undefined ||
          ((latestProposal.status === 'rejected' || latestProposal.status === 'superseded') &&
            occurrencesSinceProposal >= policy.reproposalAfterOccurrences))
      if (eligible) {
        const reservation: ProposalGenerationReservation = Object.freeze({
          id: candidate.reservationId,
          patternId: signature.id,
          proposalId: candidate.proposalId,
          observationId: observation.id,
          generation: (existing?.latestGeneration ?? 0) + 1,
          occurrence,
          reservedAt,
          expiresAt: new Date(nowMs + policy.generationReservationTimeoutMs).toISOString(),
        })
        bodies.push({ kind: 'proposal-generation-reserved', reservation })
        admittedReservationId = reservation.id
      }
      return bodies
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
