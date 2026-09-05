/** audit-codec responsibilities for the audited evolution store. @module dsh-evolver/audit-codec */

import {
  EvolutionError,
  failurePatternId,
  generationReservationId,
  observationId,
  proposalId,
  toolOutcomeId,
  type EvolutionAuditEvent,
  type EvolutionEvaluation,
  type EvolutionObservation,
  type EvolutionProposal,
  type FailurePatternId,
  type FailurePatternKeyVersion,
  type ProposalGenerationReservation,
  type ToolOutcome,
  type VerificationOutcome,
} from './domain.ts'
import { evaluateEffectiveness } from './evaluation.ts'
import { deriveFailurePatternSignature } from './pattern.ts'
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

export function eventOf(value: unknown, expectedSeq: number): EvolutionAuditEvent {
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
