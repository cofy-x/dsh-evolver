/** audit-state responsibilities for the audited evolution store. @module dsh-evolver/audit-state */

import type { observationId } from './domain.ts'
import {
  type EvolutionAuditEvent,
  type EvolutionEvaluation,
  type EvolutionObservation,
  type EvolutionProposal,
  type FailurePattern,
  type FailurePatternId,
  type GenerationReservationId,
  type ProposalGenerationReservation,
  type ProposalId,
  type ToolOutcome,
  type ToolOutcomeId,
} from './domain.ts'

export type EventBody = EvolutionAuditEvent extends infer Event
  ? Event extends EvolutionAuditEvent
    ? Omit<Event, 'schemaVersion' | 'seq' | 'at'>
    : never
  : never

export interface MutableState {
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

export function emptyState(): MutableState {
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

export function outcomeKey(outcome: Pick<ToolOutcome, 'sessionId' | 'callId'>): string {
  return `${outcome.sessionId}\u0000${outcome.callId}`
}

export function reservationById(
  state: MutableState,
  id: GenerationReservationId,
): ProposalGenerationReservation | undefined {
  return [...state.reservations.values()].find((reservation) => reservation.id === id)
}
