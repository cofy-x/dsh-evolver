/** admission responsibilities for the audited evolution store. @module dsh-evolver/admission */

import {
  EvolutionError,
  type EvolutionObservation,
  type GenerationReservationId,
  type ProposalAdmissionPolicy,
  type ProposalGenerationReservation,
  type ProposalId,
  type ToolOutcome,
} from './domain.ts'
import { outcomeKey, type EventBody, type MutableState } from './audit-state.ts'
import type { FailurePatternSignature } from './pattern.ts'
/** Lock-local admission result; provider work must start only after its events commit. */
export interface AdmissionPlan {
  readonly bodies: readonly EventBody[]
  readonly admittedReservationId?: GenerationReservationId
  readonly priorTerminalStatus?: 'rejected' | 'superseded'
}

/** Calculate events against the latest locked projection without performing I/O. */
export function planFailureAdmission(
  state: MutableState,
  outcome: ToolOutcome | undefined,
  observation: EvolutionObservation,
  signature: FailurePatternSignature,
  candidate: { readonly reservationId: GenerationReservationId; readonly proposalId: ProposalId },
  policy: ProposalAdmissionPolicy,
  reservedAt: string,
): AdmissionPlan {
  let admittedReservationId: GenerationReservationId | undefined
  let priorTerminalStatus: 'rejected' | 'superseded' | undefined
  if (outcome && state.outcomeKeys.has(outcomeKey(outcome))) return { bodies: [] }
  const existing = state.patterns.get(signature.id)
  if (
    existing &&
    (existing.toolName !== observation.toolName ||
      existing.errorCode !== observation.errorCode ||
      existing.canonicalSummary !== signature.canonicalSummary)
  ) {
    throw new EvolutionError('failure pattern hash collision or version mismatch', 'CORRUPT_STORE')
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
  return {
    bodies,
    ...(admittedReservationId ? { admittedReservationId } : {}),
    ...(priorTerminalStatus ? { priorTerminalStatus } : {}),
  }
}
