/** projection responsibilities for the audited evolution store. @module dsh-evolver/projection */

import {
  EvolutionError,
  type EvolutionAuditEvent,
  type EvolutionProposal,
  type ProposalId,
} from './domain.ts'
import { emptyState, outcomeKey, reservationById, type MutableState } from './audit-state.ts'
import { eventOf } from './audit-codec.ts'
import { createPromotionEvaluation, updateEvaluations } from './evaluation-projection.ts'
import { deriveFailurePatternSignature } from './pattern.ts'
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

export function applyEvent(state: MutableState, event: EvolutionAuditEvent): void {
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

export function parseLog(text: string): {
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
